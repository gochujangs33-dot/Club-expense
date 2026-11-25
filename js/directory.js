// ═══════════════════════════════════════════════════════════════════════
// js/directory.js — 전사원 명부 관리 전용 모듈 (v1.7.54)
//
// [신입사원 증발 버그 원인 및 방어 원칙]
// 1. 기존에는 정산 확정·이력 수정·이력 삭제·명부 등록 시 `settlements/000000/directory`
//    전체 객체를 로컬 캐시(this.directory) 기준으로 통째 덮어쓰기(overwrite)하여,
//    다른 사용자/기기에서 추가한 신입사원이 통째로 사라지는 race condition이 발생했음.
// 2. 본 모듈은 모든 명부 쓰기를 "개별 사원 키 단위 부분 update"로 전환하고,
//    정산 확정·수정·삭제 시에도 반드시 Firebase 최신 공유 명부를 먼저 읽어(merge)
//    각 사원의 `count`/`counts` 경로만 업데이트하여 신입사원 노드가 절대 지워지지 않게 함.
// 3. ⛔ AGENTS.md §1-6 불변량 준수:
//    - `_countAttendeesByEmpId` : 사번(employeeId) 없는 참석자 무조건 스킵 (이름 폴백 금지)
//    - `recalculateDirectoryCountsFromGlobal` : 완료 후 `if (this.isLoggedIn) this.render()` 필수
// ═══════════════════════════════════════════════════════════════════════

(function (global) {
    'use strict';

    const INVALID_FB_KEY_RE = /[.#$\[\]\/]/;

    // 방금 로컬에서 추가/수정/삭제한 사원 키가 직전 스냅샷 리스너에 의해 순간 되돌려지는 것을 방지
    const _pendingLocalMutations = new Map(); // name -> { type: 'upsert'|'delete', entry?, expiresAt }
    const PENDING_LOCK_MS = 8000;

    function markPendingMutation(name, type, entry = null) {
        if (!name) return;
        _pendingLocalMutations.set(name, {
            type,
            entry: entry ? JSON.parse(JSON.stringify(entry)) : null,
            expiresAt: Date.now() + PENDING_LOCK_MS
        });
    }

    function applyPendingMutations(dirObj) {
        const now = Date.now();
        for (const [name, info] of _pendingLocalMutations.entries()) {
            if (info.expiresAt <= now) {
                _pendingLocalMutations.delete(name);
                continue;
            }
            if (info.type === 'delete') {
                delete dirObj[name];
            } else if (info.type === 'upsert' && info.entry) {
                dirObj[name] = JSON.parse(JSON.stringify(info.entry));
            }
        }
        return dirObj;
    }

    function mergeDirectoryEntries(baseEntry, extraEntry) {
        if (!baseEntry) return extraEntry ? JSON.parse(JSON.stringify(extraEntry)) : null;
        if (!extraEntry) return JSON.parse(JSON.stringify(baseEntry));
        const bObj = typeof baseEntry === 'object' ? baseEntry : { id: String(baseEntry), count: 0, ids: [String(baseEntry)] };
        const eObj = typeof extraEntry === 'object' ? extraEntry : { id: String(extraEntry), count: 0, ids: [String(extraEntry)] };
        const bIds = Array.isArray(bObj.ids) ? bObj.ids.map(String) : (bObj.id ? [String(bObj.id)] : []);
        const eIds = Array.isArray(eObj.ids) ? eObj.ids.map(String) : (eObj.id ? [String(eObj.id)] : []);
        const mergedIds = Array.from(new Set([...bIds, ...eIds].filter(Boolean)));
        const mergedCreatedAts = Object.assign({}, eObj.createdAts || {}, bObj.createdAts || {});
        const merged = {
            ...eObj,
            ...bObj,
            id: String(bObj.id || eObj.id || mergedIds[0] || ''),
            ids: mergedIds,
            counts: Object.assign({}, eObj.counts || {}, bObj.counts || {}),
            count: Number(bObj.count) || Number(eObj.count) || 0
        };
        if (Object.keys(mergedCreatedAts).length > 0) merged.createdAts = mergedCreatedAts;
        if (bObj.createdAt || eObj.createdAt) merged.createdAt = Math.max(Number(bObj.createdAt) || 0, Number(eObj.createdAt) || 0);
        return merged;
    }

    // 원격 스냅샷(remoteDir)을 우선 기준으로 삼고, 로컬(localDir)에만 있는 신규 사원도 유실 없이 병합
    function mergeDirectorySnapshots(remoteDir, localDir) {
        const merged = {};
        if (remoteDir && typeof remoteDir === 'object') {
            Object.entries(remoteDir).forEach(([k, v]) => {
                if (k && v !== null && v !== undefined) merged[k] = JSON.parse(JSON.stringify(v));
            });
        }
        if (localDir && typeof localDir === 'object') {
            Object.entries(localDir).forEach(([k, v]) => {
                if (!k || v === null || v === undefined) return;
                if (!merged[k]) {
                    merged[k] = JSON.parse(JSON.stringify(v));
                } else {
                    merged[k] = mergeDirectoryEntries(merged[k], v);
                }
            });
        }
        return applyPendingMutations(merged);
    }

    // Firebase multi-path update 객체에 공유 명부 카운트만 안전하게 패치(전체 덮어쓰기 금지!)
    // - 기존 원격에 있는 사원은 count / counts 만 갱신
    // - 원격에 아직 없는 사원(신규 추가 직후 등)은 전체 노드 추가
    function appendSafeGlobalDirectoryUpdates(firebaseUpdates, computedDir, remoteSnapshotDir) {
        if (!firebaseUpdates || !computedDir || typeof computedDir !== 'object') return;
        const remote = (remoteSnapshotDir && typeof remoteSnapshotDir === 'object') ? remoteSnapshotDir : {};
        Object.entries(computedDir).forEach(([name, entry]) => {
            if (!name || INVALID_FB_KEY_RE.test(name) || !entry || typeof entry !== 'object') return;
            if (!remote[name] || typeof remote[name] !== 'object') {
                firebaseUpdates[`settlements/000000/directory/${name}`] = entry;
            } else {
                firebaseUpdates[`settlements/000000/directory/${name}/count`] = entry.count || 0;
                firebaseUpdates[`settlements/000000/directory/${name}/counts`] = entry.counts || {};
            }
        });
    }

    const DirectoryModule = {
        INVALID_FB_KEY_RE,
        mergeDirectorySnapshots,
        appendSafeGlobalDirectoryUpdates,

        install(AppState) {
            if (!AppState) return;

            AppState.bulkImportDirectory = function (list) {
                let added = 0;
                let updated = 0;
                const jsonNameSet = new Set(list.map(([n]) => n));

                const idToName = {};
                Object.entries(this.directory).forEach(([n, val]) => {
                    const ids = (typeof val === 'object' && Array.isArray(val.ids))
                        ? val.ids.map(String)
                        : [String(typeof val === 'object' ? val.id : val)];
                    ids.forEach(id => { if (!idToName[id]) idToName[id] = n; });
                });

                list.forEach(([name, employeeId]) => {
                    if (!name || !employeeId) return;
                    const eid = String(employeeId);
                    const existingName = idToName[eid];

                    if (existingName && existingName !== name && !jsonNameSet.has(existingName)) {
                        const oldEntry = this.directory[existingName];
                        if (oldEntry) {
                            const oldIds = Array.isArray(oldEntry.ids) ? oldEntry.ids.map(String) : [String(oldEntry.id)];
                            if (oldIds.length <= 1) {
                                delete this.directory[existingName];
                            } else {
                                oldEntry.ids = oldIds.filter(i => i !== eid);
                                if (String(oldEntry.id) === eid) oldEntry.id = oldEntry.ids[0];
                            }
                        }
                        const newEntry = this.directory[name];
                        if (!newEntry) {
                            this.directory[name] = { id: eid, count: 0, ids: [eid] };
                            added++;
                        } else if (typeof newEntry === 'object') {
                            if (!newEntry.ids) newEntry.ids = [String(newEntry.id)];
                            if (!newEntry.ids.includes(eid)) { newEntry.ids.push(eid); updated++; }
                        }
                        idToName[eid] = name;
                    } else {
                        const entry = this.directory[name];
                        if (entry === undefined) {
                            if (idToName[eid]) return;
                            this.directory[name] = { id: eid, count: 0, ids: [eid] };
                            idToName[eid] = name;
                            added++;
                        } else if (typeof entry === 'object') {
                            if (!entry.ids) entry.ids = [String(entry.id)];
                            if (!entry.ids.includes(eid)) {
                                entry.ids.push(eid);
                                idToName[eid] = name;
                                updated++;
                            }
                            if (entry.id !== eid && !/^\d{4}$/.test(String(entry.id))) {
                                entry.id = eid;
                            }
                        }
                    }
                });

                // 사후 정리: JSON에 없는 이름인데 모든 사번이 JSON에 등록돼 있으면 삭제
                // 단, 사용자가 직접 등록한 사원(createdAt / createdAts 보유)은 절대 자동 삭제하지 않음
                const jsonIdSet = new Set(list.map(([, id]) => String(id)));
                let cleaned = 0;
                Object.keys(this.directory).forEach(n => {
                    if (jsonNameSet.has(n)) return;
                    const e = this.directory[n];
                    if (e && typeof e === 'object' && (e.createdAt || (e.createdAts && Object.keys(e.createdAts).length > 0))) {
                        return;
                    }
                    const ids = (typeof e === 'object' && Array.isArray(e.ids))
                        ? e.ids.map(String)
                        : [String(typeof e === 'object' ? e.id : e)];
                    if (ids.every(id => jsonIdSet.has(id))) {
                        delete this.directory[n];
                        cleaned++;
                    }
                });
                if (added || updated || cleaned) this.save();
                this.render();
            };

            // ⛔ AGENTS.md §1-6 불변량: 사번(employeeId) 없는 참석자는 무조건 스킵 (이름 폴백 금지)
            AppState._countAttendeesByEmpId = function (attendeeList, idToName) {
                attendeeList.forEach(att => {
                    if (!att.name) return;
                    const empId = att.employeeId ? String(att.employeeId) : '';
                    if (!empId) return;
                    const dirKey = idToName[empId];
                    if (!dirKey) return;
                    const cur = this.directory[dirKey];
                    if (!cur || typeof cur !== 'object') return;
                    if (!cur.counts) cur.counts = {};
                    cur.counts[empId] = (cur.counts[empId] || 0) + 1;
                    cur.count = Object.values(cur.counts).reduce((s, v) => s + v, 0);
                });
            };

            AppState._resetDirectoryCounts = function () {
                Object.keys(this.directory).forEach(name => {
                    const entry = this.directory[name];
                    const ids = (typeof entry === 'object' && entry.ids)
                        ? entry.ids.map(String)
                        : (typeof entry === 'object' && entry.id ? [String(entry.id)] : []);
                    const freshCounts = {};
                    ids.forEach(id => { if (id && id !== 'undefined' && id !== 'null') freshCounts[id] = 0; });
                    if (typeof entry === 'object') { entry.count = 0; entry.counts = freshCounts; }
                    else this.directory[name] = { id: entry, count: 0, counts: freshCounts };
                });
            };

            AppState._buildIdToName = function () {
                const idToName = {};
                Object.entries(this.directory).forEach(([name, entry]) => {
                    if (typeof entry !== 'object') return;
                    const ids = entry.ids ? entry.ids.map(String) : (entry.id ? [String(entry.id)] : []);
                    ids.forEach(id => { if (id) idToName[id] = name; });
                });
                return idToName;
            };

            // ⛔ AGENTS.md §1-6 불변량: 비동기 완료 후 if (this.isLoggedIn) this.render() 호출 필수
            AppState.recalculateDirectoryCountsFromGlobal = async function () {
                if (!this.firebaseDb) { this.recalculateDirectoryCounts(); return; }
                const currentYear = new Date().getFullYear();
                this._resetDirectoryCounts();
                const idToName = this._buildIdToName();
                const yearCountsMap = {};
                const empBreakdownByYear = {};

                try {
                    const [histSnap, deletedSnap] = await Promise.all([
                        this.firebaseDb.ref('globalHistory').once('value'),
                        this.firebaseDb.ref('deletedHistoryIds').once('value')
                    ]);
                    const deletedIds = new Set(Object.keys(deletedSnap.val() || {}));
                    const seenIds = new Set();
                    let counted = 0;

                    histSnap.forEach(child => {
                        const entry = child.val();
                        if (!entry || !entry.id) return;
                        if (deletedIds.has(String(child.key))) return;
                        if (seenIds.has(entry.id)) return;
                        seenIds.add(entry.id);
                        const entryYear = entry.settlementDate
                            ? parseInt(entry.settlementDate.slice(0, 4), 10)
                            : (entry.date ? new Date(entry.date).getFullYear() : new Date(entry.id).getFullYear());
                        if (Number.isNaN(entryYear)) return;

                        const yKey = String(entryYear);
                        if (!yearCountsMap[yKey]) yearCountsMap[yKey] = {};
                        if (!empBreakdownByYear[yKey]) empBreakdownByYear[yKey] = {};
                        const clubName = String(entry.clubName || '기본 클럽').trim() || '기본 클럽';
                        const dStr = entry.settlementDate || (entry.date ? String(entry.date).slice(0, 10) : '');

                        const entrySeenEmpIds = new Set();
                        (entry.attendees || []).forEach(att => {
                            const empId = att && att.employeeId ? String(att.employeeId).trim() : '';
                            if (!empId || entrySeenEmpIds.has(empId)) return;
                            entrySeenEmpIds.add(empId);
                            yearCountsMap[yKey][empId] = (yearCountsMap[yKey][empId] || 0) + 1;
                            if (!empBreakdownByYear[yKey][empId]) empBreakdownByYear[yKey][empId] = {};
                            if (!empBreakdownByYear[yKey][empId][clubName]) empBreakdownByYear[yKey][empId][clubName] = [];
                            if (dStr) empBreakdownByYear[yKey][empId][clubName].push(dStr);
                        });

                        if (entryYear !== currentYear) return;
                        counted++;
                        this._countAttendeesByEmpId(entry.attendees || [], idToName);
                    });
                    this._directoryCountsByYear = yearCountsMap;
                    this._empClubBreakdownByYear = empBreakdownByYear;
                    console.log(`[명부 카운트] ${currentYear}년 정산 ${counted}건 처리, 명부 ${Object.keys(this.directory).length}명`);
                } catch (err) {
                    console.error('globalHistory 카운트 재계산 실패:', err);
                    this.recalculateDirectoryCounts();
                }
                if (this.isLoggedIn && typeof this.render === 'function') this.render();
            };

            AppState.recalculateDirectoryCounts = function () {
                const currentYear = new Date().getFullYear();
                this._resetDirectoryCounts();
                const idToName = this._buildIdToName();
                const seenIds = new Set();
                (this.settlementHistory || []).forEach(entry => {
                    if (!entry || !entry.id) return;
                    if (seenIds.has(entry.id)) return;
                    seenIds.add(entry.id);
                    const entryYear = entry.settlementDate
                        ? parseInt(entry.settlementDate.slice(0, 4), 10)
                        : (entry.date ? new Date(entry.date).getFullYear() : new Date(entry.id).getFullYear());
                    if (entryYear !== currentYear) return;
                    this._countAttendeesByEmpId(entry.attendees || [], idToName);
                });
            };

            // 아직 로컬 상태에 넣지 않은 신규 이력까지 포함해 저장용 명부 카운트를 계산한다.
            // 기존 명부 객체(createdAt/createdAts 포함)는 건드리지 않으며, 사번 없는 참석자는 반드시 스킵한다(v1.6.198 불변량).
            AppState.buildDirectoryCountsForHistory = function (historyList, sourceDirectory = this.directory) {
                const directory = JSON.parse(JSON.stringify(sourceDirectory || {}));
                const currentYear = new Date().getFullYear();
                const idToName = {};

                Object.entries(directory).forEach(([name, entry]) => {
                    const ids = (entry && typeof entry === 'object' && entry.ids)
                        ? entry.ids.map(String)
                        : (entry && typeof entry === 'object' && entry.id
                            ? [String(entry.id)]
                            : (entry !== null && entry !== undefined && typeof entry !== 'object' ? [String(entry)] : []));
                    const counts = {};
                    ids.forEach(id => {
                        if (id && id !== 'undefined' && id !== 'null') {
                            counts[id] = 0;
                            idToName[id] = name;
                        }
                    });
                    if (entry && typeof entry === 'object') {
                        entry.count = 0;
                        entry.counts = counts;
                    } else {
                        directory[name] = { id: entry, count: 0, counts };
                    }
                });

                const seenIds = new Set();
                (historyList || []).forEach(historyEntry => {
                    if (!historyEntry || !historyEntry.id) return;
                    const historyId = String(historyEntry.id);
                    if (seenIds.has(historyId)) return;
                    seenIds.add(historyId);
                    if (getHistoryEntryYear(historyEntry) !== currentYear) return;
                    (historyEntry.attendees || []).forEach(attendee => {
                        if (!attendee || !attendee.name) return;
                        const employeeId = attendee && attendee.employeeId ? String(attendee.employeeId) : '';
                        if (!employeeId) return;
                        const directoryKey = idToName[employeeId];
                        const directoryEntry = directoryKey ? directory[directoryKey] : null;
                        if (!directoryEntry || typeof directoryEntry !== 'object') return;
                        directoryEntry.counts[employeeId] = (directoryEntry.counts[employeeId] || 0) + 1;
                        directoryEntry.count = Object.values(directoryEntry.counts).reduce((sum, value) => sum + value, 0);
                    });
                });

                return directory;
            };

            // Firebase 최신 공유 명부를 읽어 로컬 대기 변경사항과 병합한 뒤, 카운트를 계산하고
            // `settlements/000000/directory/{name}/count(s)` 단위 패치까지 생성해 반환한다.
            AppState.prepareGlobalDirectorySync = async function (historyList, firebaseUpdates) {
                let remoteDir = null;
                if (this.firebaseDb) {
                    try {
                        const snap = await this.firebaseDb.ref('settlements/000000/directory').once('value');
                        remoteDir = snap.val();
                    } catch (e) {
                        console.warn('최신 공유 명부 조회 실패(로컬 기준 폴백):', e);
                    }
                }
                const mergedSource = mergeDirectorySnapshots(remoteDir, this.directory);
                const computedDir = this.buildDirectoryCountsForHistory(historyList, mergedSource);
                if (firebaseUpdates) {
                    appendSafeGlobalDirectoryUpdates(firebaseUpdates, computedDir, remoteDir);
                }
                return computedDir;
            };

            // 0번 데이터 원칙: 전사원 명부는 관리자(000000) 명부를 유일한 기준으로 실시간 공유
            AppState.loadDirectoryShared = function () {
                if (!this.firebaseDb) return Promise.resolve();
                return new Promise((resolve) => {
                    this.firebaseDb.ref('settlements/000000/directory').off('value');
                    this.firebaseDb.ref('settlements/000000/directory').on('value', snapshot => {
                        const adminDir = snapshot.val();
                        if (adminDir && typeof adminDir === 'object') {
                            this.directory = applyPendingMutations(JSON.parse(JSON.stringify(adminDir)));
                            if (this.isLoggedIn) {
                                this.render();
                            }
                        }
                        resolve();
                    }, (err) => {
                        console.warn('전사원 명부 실시간 동기화 오류:', err);
                        resolve();
                    });
                });
            };

            // 사원 등록/수정: 전체 명부 덮어쓰기 금지 — 해당 사원 키만 원자적 update()
            AppState.addDirectoryEntry = async function (name, employeeId) {
                const cleanName = String(name || '').trim();
                const eid = String(employeeId || '').trim();
                if (!cleanName || !eid) return false;
                if (INVALID_FB_KEY_RE.test(cleanName)) {
                    alert('이름에는 특수문자(. # $ [ ] /)를 사용할 수 없습니다.');
                    return false;
                }

                const previousName = this.editingDirName;
                const previousId = this.editingDirId;
                const isEditing = previousName !== null;
                const now = Date.now();

                if (this.editingDirName !== null) {
                    const currentData = this.directory[this.editingDirName];
                    const currentCount = typeof currentData === 'object' ? (currentData.count || 0) : 0;
                    const currentCounts = (currentData && typeof currentData === 'object' && currentData.counts)
                        ? Object.assign({}, currentData.counts) : {};
                    const currentCreatedAts = (currentData && typeof currentData === 'object' && currentData.createdAts)
                        ? Object.assign({}, currentData.createdAts) : {};
                    const nameChanged = this.editingDirName !== cleanName;

                    if (nameChanged) {
                        delete this.directory[this.editingDirName];
                        markPendingMutation(this.editingDirName, 'delete');

                        const existing = this.directory[cleanName];
                        if (existing) {
                            if (typeof existing !== 'object') {
                                this.directory[cleanName] = { id: String(existing), count: existing.count || 0, ids: [String(existing)] };
                            }
                            if (!this.directory[cleanName].ids) this.directory[cleanName].ids = [String(this.directory[cleanName].id)];
                            if (!this.directory[cleanName].ids.includes(eid)) this.directory[cleanName].ids.push(eid);
                            if (!this.directory[cleanName].createdAts) this.directory[cleanName].createdAts = {};
                            this.directory[cleanName].createdAts[eid] = currentCreatedAts[eid] || now;
                            this.directory[cleanName].createdAt = Math.max(Number(this.directory[cleanName].createdAt) || 0, now);
                        } else {
                            this.directory[cleanName] = {
                                id: eid,
                                count: currentCount,
                                ids: [eid],
                                counts: currentCounts,
                                createdAts: { [eid]: currentCreatedAts[eid] || now },
                                createdAt: now
                            };
                        }
                    } else {
                        let ids = (currentData && Array.isArray(currentData.ids)) ? currentData.ids.map(String) : [String(currentData && currentData.id ? currentData.id : eid)];
                        const oldId = this.editingDirId ? String(this.editingDirId) : null;
                        if (oldId && ids.includes(oldId)) {
                            ids = ids.map(i => i === oldId ? eid : i);
                        } else if (!ids.includes(eid)) {
                            ids.push(eid);
                        }
                        const primaryId = (oldId && String(currentData.id) === oldId) ? eid : String(currentData.id || eid);
                        this.directory[cleanName] = {
                            id: primaryId,
                            count: currentCount,
                            ids,
                            counts: currentCounts,
                            createdAts: { ...currentCreatedAts, [eid]: currentCreatedAts[oldId] || now },
                            createdAt: (currentData && currentData.createdAt) || now
                        };
                    }
                } else {
                    const existing = this.directory[cleanName];
                    if (existing && typeof existing === 'object') {
                        if (!existing.ids) existing.ids = [String(existing.id)];
                        if (!existing.ids.includes(eid)) existing.ids.push(eid);
                        if (!existing.createdAts) existing.createdAts = {};
                        existing.createdAts[eid] = now;
                        existing.createdAt = now;
                    } else {
                        this.directory[cleanName] = { id: eid, count: 0, ids: [eid], createdAts: { [eid]: now }, createdAt: now };
                    }
                    try {
                        localStorage.setItem(`dir_reg_${cleanName}_${eid}`, String(now));
                    } catch (e) {}
                }

                markPendingMutation(cleanName, 'upsert', this.directory[cleanName]);
                this.cancelEditDirectory();

                let syncPromise = Promise.resolve(true);
                if (this.firebaseDb) {
                    const updates = {};
                    updates[`settlements/000000/directory/${cleanName}`] = this.directory[cleanName];
                    if (isEditing && previousName && previousName !== cleanName && !INVALID_FB_KEY_RE.test(previousName)) {
                        updates[`settlements/000000/directory/${previousName}`] = null;
                    }
                    if (this.currentPin && this.currentPin !== '000000') {
                        updates[`settlements/${this.currentPin}/directory/${cleanName}`] = this.directory[cleanName];
                        if (isEditing && previousName && previousName !== cleanName && !INVALID_FB_KEY_RE.test(previousName)) {
                            updates[`settlements/${this.currentPin}/directory/${previousName}`] = null;
                        }
                    }
                    syncPromise = this.firebaseDb.ref().update(updates).then(() => true).catch(e => {
                        console.error('공유 명부 등록 동기화 실패:', e);
                        alert('전사원 명부 서버 저장에 실패했습니다. 네트워크 상태를 확인 후 다시 시도해 주세요.');
                        return false;
                    });
                }

                const savePromise = syncPromise.then(() => this.save());
                this.writeAuditAfterSave(savePromise, {
                    action: isEditing ? 'UPDATE' : 'CREATE',
                    targetType: isEditing ? '전사원 명부 변경' : '전사원 명부 등록',
                    targetId: eid,
                    targetLabel: `${cleanName} (${eid})`,
                    summary: isEditing
                        ? `전사원 명부 수정: '${previousName} (${previousId || '-'})' → '${cleanName} (${eid})'`
                        : `전사원 명부 등록: '${cleanName} (${eid})'`,
                    details: { 이전이름: previousName, 이전사번: previousId, 변경이름: cleanName, 변경사번: eid }
                });
                this.render();
                this.updateDatalist();
                return true;
            };

            // 사원 삭제: 관리자 전용, 해당 사원 키만 원자적 update()
            AppState.deleteFromDirectory = function (name, id) {
                if (!this.hasAdminAccess) {
                    alert(t('alert.directory_delete_restricted'));
                    return;
                }
                try {
                    const entry = this.directory[name];
                    const deletedId = id || (typeof entry === 'object' ? entry?.id : entry);
                    let remainingEntry = null;
                    if (id && typeof entry === 'object' && Array.isArray(entry.ids) && entry.ids.length > 1) {
                        entry.ids = entry.ids.filter(i => String(i) !== String(id));
                        if (String(entry.id) === String(id)) entry.id = entry.ids[0];
                        if (entry.counts && entry.counts[String(id)] !== undefined) {
                            delete entry.counts[String(id)];
                            entry.count = Object.values(entry.counts).reduce((s, v) => s + (Number(v) || 0), 0);
                        }
                        remainingEntry = entry;
                        markPendingMutation(name, 'upsert', entry);
                    } else {
                        delete this.directory[name];
                        if (this.editingDirName === name) this.cancelEditDirectory();
                        markPendingMutation(name, 'delete');
                    }

                    let syncPromise = Promise.resolve(true);
                    if (this.firebaseDb && !INVALID_FB_KEY_RE.test(name)) {
                        const updates = {};
                        updates[`settlements/000000/directory/${name}`] = remainingEntry;
                        if (this.currentPin && this.currentPin !== '000000') {
                            updates[`settlements/${this.currentPin}/directory/${name}`] = remainingEntry;
                        }
                        syncPromise = this.firebaseDb.ref().update(updates).then(() => true).catch(e => {
                            console.error('공유 명부 삭제 동기화 실패:', e);
                            return false;
                        });
                    }
                    const savePromise = syncPromise.then(() => this.save());
                    this.writeAuditAfterSave(savePromise, {
                        action: 'DELETE',
                        targetType: '전사원 명부',
                        targetId: deletedId || '',
                        targetLabel: `${name} (${deletedId || '-'})`,
                        summary: `전사원 명부에서 '${name} (${deletedId || '-'})' 삭제`,
                        details: { 이름: name, 사번: deletedId || '' }
                    });
                    this.render();
                    this.updateDatalist();
                } catch (error) {
                    console.error('Error encountered in deleteFromDirectory:', error);
                }
            };

            // 사원 누적 횟수 직접 수정 (관리자 전용): 해당 사원의 count/counts만 부분 update()
            AppState.updateDirectoryMemberCount = function (dirName, dirId, newCount) {
                if (!this.directory || this.directory[dirName] === undefined) return;
                const cur = this.directory[dirName];
                const curId = typeof cur === 'object' ? cur.id : cur;
                const curIds = typeof cur === 'object' && Array.isArray(cur.ids) ? cur.ids : [curId];
                const curCounts = (typeof cur === 'object' && cur.counts) ? Object.assign({}, cur.counts) : {};
                const previousCount = dirId ? (curCounts[dirId] || 0) : 0;
                if (dirId) curCounts[dirId] = newCount;
                const totalCount = Object.values(curCounts).reduce((s, v) => s + v, 0);
                const nextEntry = {
                    ...(typeof cur === 'object' ? cur : {}),
                    id: curId,
                    count: totalCount,
                    ids: curIds,
                    counts: curCounts
                };
                this.directory[dirName] = nextEntry;
                markPendingMutation(dirName, 'upsert', nextEntry);

                let syncPromise = Promise.resolve(true);
                if (this.firebaseDb && !INVALID_FB_KEY_RE.test(dirName)) {
                    const updates = {};
                    updates[`settlements/000000/directory/${dirName}/count`] = totalCount;
                    updates[`settlements/000000/directory/${dirName}/counts`] = curCounts;
                    if (this.currentPin && this.currentPin !== '000000') {
                        updates[`settlements/${this.currentPin}/directory/${dirName}/count`] = totalCount;
                        updates[`settlements/${this.currentPin}/directory/${dirName}/counts`] = curCounts;
                    }
                    syncPromise = this.firebaseDb.ref().update(updates).then(() => true).catch(e => {
                        console.error('공유 명부 카운트 동기화 실패:', e);
                        return false;
                    });
                }
                const savePromise = syncPromise.then(() => this.save());
                this.writeAuditAfterSave(savePromise, {
                    action: 'UPDATE',
                    targetType: '전사원 명부 카운트 변경',
                    targetId: dirId || '',
                    targetLabel: `${dirName} (${dirId || '-'})`,
                    summary: `전사원 명부 '${dirName} (${dirId || '-'})' 누적 참석 횟수 수정: ${previousCount}회 → ${newCount}회`,
                    details: { 이전횟수: previousCount, 변경횟수: newCount }
                });
                this.render();
            };
        }
    };

    global.DirectoryModule = DirectoryModule;
    if (typeof AppState !== 'undefined') {
        DirectoryModule.install(AppState);
    }
})(window);
