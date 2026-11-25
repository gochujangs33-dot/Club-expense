// ═══════════════════════════════════════════════════════════════════════
// js/regular-members.js — 클럽별 정회원 관리 전용 모듈 (v1.7.63)
//
// [연도별 독립 관리 및 이월 원칙]
// 1. 저장 경로: `yearlyClubRegistry/{조회연도}/{clubId}/regularMembers`
//    (실제 올해 변경 시 공용 `clubRegistry/{clubId}/regularMembers` 병행 동기화)
// 2. 해가 바뀌어도(예: 2026년 -> 2027년) 해당 연도 스냅샷이 아직 생성되기 전에는
//    직전 최신 연도의 정회원 명단을 그대로 이어받아(이월) 표시·사용한다.
// 3. 새 연도(예: 2027년)에서 정회원을 수정하면 그 연도 스냅샷만 독립 저장되며,
//    상단 조회 연도를 전년(2026년)으로 바꾸면 전년도 정회원 명단이 그대로 표시된다.
// ═══════════════════════════════════════════════════════════════════════

(function (global) {
    'use strict';

    function normalizeRegularMembersList(membersArray) {
        const cleanList = [];
        const seenKeys = new Set();
        (Array.isArray(membersArray) ? membersArray : []).forEach(m => {
            if (!m || !m.name) return;
            const name = String(m.name).trim();
            const employeeId = String(m.employeeId || m.id || '').trim();
            if (!name) return;
            const key = employeeId ? `id:${employeeId}` : `name:${name}`;
            if (seenKeys.has(key)) return;
            seenKeys.add(key);
            cleanList.push({ name, employeeId });
        });
        return cleanList;
    }

    function installRegularMembersAppState(AppState) {
        if (!AppState) return;

        // 지정 연도의 클럽 정회원 목록 조회 (미존재 시 직전 최신 연도에서 자동 이월)
        AppState.getRegularMembersForYear = function (clubId, year = null) {
            if (!clubId) return [];
            const targetY = Number(year) || this.getActiveQueryYear();
            const yKey = String(targetY);
            const yrReg = this.yearlyClubRegistry && this.yearlyClubRegistry[yKey];
            if (yrReg && yrReg[clubId] && Array.isArray(yrReg[clubId].regularMembers)) {
                return JSON.parse(JSON.stringify(yrReg[clubId].regularMembers));
            }
            const curClub = this.clubRegistry && this.clubRegistry[clubId];
            if (curClub && Array.isArray(curClub.regularMembers)) {
                return JSON.parse(JSON.stringify(curClub.regularMembers));
            }
            // 직전 최신 연도 스냅샷에서 승계
            if (this.yearlyClubRegistry) {
                const prevYears = Object.keys(this.yearlyClubRegistry)
                    .map(k => Number(k))
                    .filter(y => !Number.isNaN(y) && y < targetY)
                    .sort((a, b) => b - a);
                for (const py of prevYears) {
                    const prevClub = this.yearlyClubRegistry[String(py)] && this.yearlyClubRegistry[String(py)][clubId];
                    if (prevClub && Array.isArray(prevClub.regularMembers)) {
                        return JSON.parse(JSON.stringify(prevClub.regularMembers));
                    }
                }
            }
            const baseClub = this._baseClubRegistry && this._baseClubRegistry[clubId];
            return (baseClub && Array.isArray(baseClub.regularMembers))
                ? JSON.parse(JSON.stringify(baseClub.regularMembers))
                : [];
        };

        // 클럽별 정회원 명단 저장 (조회 연도 기준 독립 저장 + 전년도 보호 백업)
        AppState.setClubRegularMembers = function (clubId, membersArray, year = null) {
            if (!clubId || !this.clubRegistry || !this.clubRegistry[clubId]) return Promise.resolve(false);
            const club = this.clubRegistry[clubId];
            const cleanList = normalizeRegularMembersList(membersArray);
            const targetY = Number(year) || this.getActiveQueryYear();
            const realY = new Date().getFullYear();

            const updates = {};

            // 해가 바뀐 뒤(예: 2027년) 첫 수정 시 직전 연도(2026년) 스냅샷이 아직 없다면
            // 현재 _baseClubRegistry를 전년도 스냅샷으로 먼저 보존해 전년도 조회 시 명단이 덮이지 않도록 보호
            const prevYearKey = String(realY - 1);
            if (targetY >= realY && this.yearlyClubRegistry && !this.yearlyClubRegistry[prevYearKey] && this._baseClubRegistry && Object.keys(this._baseClubRegistry).length > 0) {
                const hasHistoryForPrevYear = Array.isArray(this.globalHistory) && this.globalHistory.some(e => e && Number((e.settlementDate || '').slice(0, 4)) === (realY - 1));
                if (hasHistoryForPrevYear) {
                    const prevSnapshot = JSON.parse(JSON.stringify(this._baseClubRegistry));
                    this.yearlyClubRegistry[prevYearKey] = prevSnapshot;
                    updates[`yearlyClubRegistry/${prevYearKey}`] = prevSnapshot;
                }
            }

            club.regularMembers = cleanList;
            if (!this.firebaseDb) return Promise.resolve(true);

            this._buildYearlyClubUpdates(updates, clubId, cleanList, 'regularMembers', targetY);
            this.appendAuditUpdate(updates, {
                action: 'UPDATE',
                targetType: '클럽 정회원 관리',
                targetId: clubId,
                targetLabel: `${club.name || clubId} (${targetY}년)`,
                summary: `클럽 '${club.name || clubId}' (${targetY}년) 정회원 명단 업데이트 (총 ${cleanList.length}명)`,
                clubId,
                clubName: club.name || '',
                details: {
                    기준연도: `${targetY}년`,
                    정회원수: cleanList.length,
                    명단: cleanList.map(m => `${m.name}(${m.employeeId || '-'})`).join(', ')
                }
            });
            return this.firebaseDb.ref().update(updates)
                .then(() => true)
                .catch(err => {
                    console.error('클럽 정회원 저장 실패:', err);
                    return false;
                });
        };
    }

    global.__installRegularMembers = function (B) {
        const AppState = global.AppState;
        if (!AppState) return;
        installRegularMembersAppState(AppState);

        const loadRegBtn = document.getElementById('load-regular-members-btn');
        const manageRegBtn = document.getElementById('manage-regular-members-btn');
        const modal = document.getElementById('club-regular-members-modal');
        const closeBtn = document.getElementById('close-regular-members-modal-btn');
        const doneBtn = document.getElementById('done-regular-members-modal-btn');
        const clubNameLabel = document.getElementById('regular-members-club-name');
        const yearBadge = document.getElementById('regular-members-year-badge');
        const clubIdHidden = document.getElementById('regular-members-club-id');
        const nameInput = document.getElementById('regular-member-name-input');
        const dropdown = document.getElementById('regular-member-name-dropdown');
        const idInput = document.getElementById('regular-member-id-input');
        const addBtn = document.getElementById('add-regular-member-btn');
        const clearAllBtn = document.getElementById('clear-regular-members-btn');
        const countLabel = document.getElementById('regular-members-count-label');
        const listContainer = document.getElementById('regular-members-list-container');

        function getActiveRegularClubId() {
            return (clubIdHidden ? clubIdHidden.value : '') || '';
        }

        function resolveClubEntry(preferClubId) {
            const registry = AppState.clubRegistry || {};
            if (preferClubId && registry[preferClubId]) return [preferClubId, registry[preferClubId]];
            if (AppState.clubId && registry[AppState.clubId]) return [AppState.clubId, registry[AppState.clubId]];
            if (AppState.clubName) {
                const found = Object.entries(registry).find(([, c]) => c && c.name === AppState.clubName);
                if (found) return found;
            }
            const first = Object.entries(registry).find(([, c]) => c && c.name);
            return first || [null, null];
        }

        function loadRegularMembersToAttendees(clubId) {
            const [cid, club] = resolveClubEntry(clubId);
            if (!cid || !club) {
                alert('상단에서 먼저 클럽을 선택해 주세요.');
                return false;
            }
            const activeY = AppState.getActiveQueryYear();
            const regList = AppState.getRegularMembersForYear(cid, activeY);
            if (regList.length === 0) {
                openClubRegularMembersModal(cid);
                return false;
            }
            const existingIds = new Set((AppState.attendees || []).map(a => String(a.employeeId || '').trim()).filter(Boolean));
            const existingNames = new Set((AppState.attendees || []).map(a => String(a.name || '').trim()).filter(Boolean));
            const baseId = Date.now();
            let addedCount = 0;

            regList.forEach((m, seq) => {
                if (!m || !m.name) return;
                const name = String(m.name).trim();
                const empId = String(m.employeeId || '').trim();
                if ((empId && existingIds.has(empId)) || (!empId && existingNames.has(name))) return;
                AppState.attendees.push({
                    id: baseId + seq,
                    name,
                    employeeId: empId
                });
                if (empId) existingIds.add(empId);
                existingNames.add(name);
                addedCount++;
            });

            if (addedCount === 0) {
                alert(`'${club.name}' (${activeY}년) 등록 정회원(${regList.length}명)이 이미 모두 현재 참석자 명단에 포함되어 있습니다.`);
                return false;
            }
            AppState.memberCount = AppState.attendees.length;
            AppState.save();
            AppState.render();
            return true;
        }

        function renderRegularMembersList() {
            if (!listContainer) return;
            const clubId = getActiveRegularClubId();
            const activeY = AppState.getActiveQueryYear();
            const club = clubId && AppState.clubRegistry ? AppState.clubRegistry[clubId] : null;
            if (clubNameLabel && club) clubNameLabel.textContent = club.name || '';
            if (yearBadge) yearBadge.textContent = `${activeY}년 기준`;

            const regList = clubId ? AppState.getRegularMembersForYear(clubId, activeY) : [];
            if (countLabel) countLabel.textContent = String(regList.length);
            listContainer.innerHTML = '';

            if (regList.length === 0) {
                listContainer.innerHTML = `<div class="empty-state" style="padding:1.8rem 0.5rem;"><span class="empty-icon">⭐</span><p>${activeY}년 등록된 정회원이 없습니다. 위에서 이름/사번을 검색하여 추가해 주세요.</p></div>`;
                return;
            }

            const frag = document.createDocumentFragment();
            regList.forEach((m, idx) => {
                const row = document.createElement('div');
                row.className = 'regular-member-row';
                row.innerHTML = `
                    <div class="regular-member-info">
                        <span class="regular-member-index">${idx + 1}</span>
                        <strong class="regular-member-name">${AppState.escapeHtml(m.name)}</strong>
                        <span class="regular-member-id">${AppState.escapeHtml(m.employeeId || '-')}</span>
                    </div>
                    <button type="button" class="regular-member-del-btn" data-idx="${idx}">삭제</button>
                `;
                row.querySelector('.regular-member-del-btn')?.addEventListener('click', async () => {
                    const next = regList.filter((_, i) => i !== idx);
                    await AppState.setClubRegularMembers(clubId, next, activeY);
                    renderRegularMembersList();
                    if (typeof global.renderClubManagement === 'function') global.renderClubManagement();
                });
                frag.appendChild(row);
            });
            listContainer.appendChild(frag);
        }

        function openClubRegularMembersModal(preferClubId) {
            if (!modal) return;
            const [resolvedId, resolvedClub] = resolveClubEntry(preferClubId);
            if (!resolvedId || !resolvedClub) {
                alert('상단에서 먼저 클럽을 선택해 주세요.');
                return;
            }
            if (clubIdHidden) clubIdHidden.value = resolvedId;
            if (clubNameLabel) clubNameLabel.textContent = resolvedClub.name || '';
            renderRegularMembersList();
            if (nameInput) nameInput.value = '';
            if (idInput) idInput.value = '';
            if (dropdown) dropdown.classList.add('hidden');
            modal.classList.remove('hidden');

            const db = AppState.firebaseDb;
            if (db && (!B.lastHistoryList || B.lastHistoryList.length === 0)) {
                Promise.all([
                    db.ref('globalHistory').once('value'),
                    db.ref('deletedHistoryIds').once('value')
                ]).then(([snapshot, deletedSnap]) => {
                    const historyData = snapshot.val() || {};
                    const delMap = deletedSnap.val() || {};
                    if (typeof B.extractValidGlobalHistory === 'function' && typeof B.compareHistoryEntriesNewestFirst === 'function') {
                        B.lastHistoryList = B.extractValidGlobalHistory(historyData, delMap, db)
                            .sort(B.compareHistoryEntriesNewestFirst);
                    }
                    if (nameInput && nameInput.value.trim()) {
                        nameInput.dispatchEvent(new Event('input'));
                    }
                }).catch(() => {});
            }
        }

        function closeClubRegularMembersModal() {
            if (modal) modal.classList.add('hidden');
            if (dropdown) dropdown.classList.add('hidden');
        }

        function refreshRegularMembersModalIfOpen() {
            if (modal && !modal.classList.contains('hidden')) {
                renderRegularMembersList();
            }
        }

        global.openClubRegularMembersModal = openClubRegularMembersModal;
        global.refreshRegularMembersModalIfOpen = refreshRegularMembersModalIfOpen;

        if (loadRegBtn) {
            loadRegBtn.addEventListener('click', () => {
                if (!AppState.clubName && !AppState.clubId) {
                    alert('상단에서 먼저 클럽을 선택해 주세요.');
                    return;
                }
                loadRegularMembersToAttendees(AppState.clubId);
            });
        }
        if (manageRegBtn) {
            manageRegBtn.addEventListener('click', () => {
                openClubRegularMembersModal(AppState.clubId);
            });
        }
        if (closeBtn) closeBtn.addEventListener('click', closeClubRegularMembersModal);
        if (doneBtn) doneBtn.addEventListener('click', closeClubRegularMembersModal);
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeClubRegularMembersModal();
            });
        }

        function getRecentClubAttendanceForTarget(employeeId, targetClubId, targetClubName) {
            const id = String(employeeId || '').trim();
            if (!id) return null;
            const sources = [...(B.lastHistoryList || []), ...(AppState.clubHistory || []), ...(AppState.settlementHistory || [])];
            let latestInClub = null;
            let latestAny = null;
            sources.forEach(entry => {
                if (!entry) return;
                const matched = (entry.attendees || []).some(a => a && a.employeeId != null && String(a.employeeId).trim() === id);
                if (!matched) return;
                const time = entry.settlementDate
                    ? new Date(entry.settlementDate + 'T00:00:00').getTime()
                    : (entry.date ? new Date(entry.date).getTime() : (entry.id || 0));
                const dateStr = entry.settlementDate || (entry.date ? new Date(entry.date).toISOString().slice(0, 10) : '');
                const inSameClub = typeof B.historyMatchesClub === 'function'
                    ? B.historyMatchesClub(entry, targetClubId, targetClubName)
                    : (entry.clubId === targetClubId || entry.clubName === targetClubName);
                if (inSameClub) {
                    if (!latestInClub || time > latestInClub.time) {
                        latestInClub = { time, dateStr, sameClub: true, clubName: entry.clubName || targetClubName || '' };
                    }
                } else {
                    if (!latestAny || time > latestAny.time) {
                        latestAny = { time, dateStr, sameClub: false, clubName: entry.clubName || '' };
                    }
                }
            });
            return latestInClub || latestAny;
        }

        if (nameInput && dropdown) {
            nameInput.addEventListener('input', () => {
                const q = nameInput.value.trim();
                if (idInput) idInput.value = '';
                if (!q) {
                    dropdown.classList.add('hidden');
                    return;
                }
                const matches = AppState.getAllDirectoryMatches ? AppState.getAllDirectoryMatches(q).slice(0, 15) : [];
                if (matches.length === 0) {
                    dropdown.classList.add('hidden');
                    return;
                }
                const selClubId = getActiveRegularClubId();
                const selClub = selClubId && AppState.clubRegistry ? AppState.clubRegistry[selClubId] : null;
                const selClubName = selClub ? selClub.name : AppState.clubName;

                dropdown.innerHTML = matches.map(m => {
                    const isDupe = matches.filter(x => x.name === m.name).length > 1;
                    const recent = isDupe ? getRecentClubAttendanceForTarget(m.id, selClubId, selClubName) : null;
                    const recentStyle = recent
                        ? (recent.sameClub
                            ? 'background:rgba(52,211,153,0.12); border-left:3px solid rgb(52,211,153);'
                            : 'background:rgba(59,130,246,0.09); border-left:3px solid rgb(59,130,246);')
                        : '';
                    const recentBadge = recent
                        ? (recent.sameClub
                            ? `<span style="font-size:0.7rem; color:#10b981; font-weight:700; margin-left:0.35rem;">✅ 최근 참석 (${AppState.escapeHtml(recent.dateStr)})</span>`
                            : `<span style="font-size:0.7rem; color:#3b82f6; font-weight:700; margin-left:0.35rem;">📌 최근 참석 (${AppState.escapeHtml(recent.clubName)} · ${AppState.escapeHtml(recent.dateStr)})</span>`)
                        : '';
                    return `<div class="attendee-dropdown-item" data-name="${AppState.escapeHtml(m.name)}" data-id="${AppState.escapeHtml(m.id)}" style="${recentStyle} display:flex; align-items:center; justify-content:space-between; gap:0.4rem;">
                        <span><strong>${AppState.escapeHtml(m.name)}</strong> <small style="color:var(--text-secondary);">(${AppState.escapeHtml(m.id)})</small></span>
                        ${recentBadge}
                    </div>`;
                }).join('');
                dropdown.classList.remove('hidden');
                dropdown.querySelectorAll('.attendee-dropdown-item').forEach(item => {
                    item.addEventListener('mousedown', (e) => {
                        e.preventDefault();
                        nameInput.value = item.getAttribute('data-name') || '';
                        if (idInput) idInput.value = item.getAttribute('data-id') || '';
                        dropdown.classList.add('hidden');
                        nameInput.focus();
                    });
                });
            });
        }

        async function handleAddSingleRegularMember() {
            const clubId = getActiveRegularClubId();
            const club = clubId && AppState.clubRegistry ? AppState.clubRegistry[clubId] : null;
            if (!club) return;
            const activeY = AppState.getActiveQueryYear();
            const name = (nameInput ? nameInput.value : '').trim();
            let empId = (idInput ? idInput.value : '').trim();
            if (!name) {
                alert('정회원으로 등록할 이름을 입력해 주세요.');
                return;
            }
            if (!empId && AppState.getAllDirectoryMatches) {
                const exact = AppState.getAllDirectoryMatches(name).filter(m => m.name === name);
                if (exact.length === 1) {
                    empId = exact[0].id;
                } else if (exact.length > 1 && typeof global.showEmpIdPickerPopup === 'function') {
                    global.showEmpIdPickerPopup(name, exact, async (picked) => {
                        if (idInput) idInput.value = picked.id;
                        await handleAddSingleRegularMember();
                    });
                    return;
                }
            }
            if (!empId) {
                alert('사번을 입력하거나 드롭다운에서 사원을 선택해 주세요.');
                return;
            }
            const current = AppState.getRegularMembersForYear(clubId, activeY);
            if (current.some(m => String(m.employeeId) === empId)) {
                alert(`이미 정회원으로 등록된 사번입니다: ${name} (${empId})`);
                return;
            }
            current.push({ name, employeeId: empId });
            await AppState.setClubRegularMembers(clubId, current, activeY);
            if (nameInput) nameInput.value = '';
            if (idInput) idInput.value = '';
            if (dropdown) dropdown.classList.add('hidden');
            renderRegularMembersList();
            if (typeof global.renderClubManagement === 'function') global.renderClubManagement();
            if (nameInput) nameInput.focus();
        }

        if (addBtn) addBtn.addEventListener('click', handleAddSingleRegularMember);
        [nameInput, idInput].forEach(inp => {
            if (!inp) return;
            inp.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddSingleRegularMember();
                }
            });
        });

        if (clearAllBtn) {
            clearAllBtn.addEventListener('click', () => {
                const clubId = getActiveRegularClubId();
                const activeY = AppState.getActiveQueryYear();
                const club = clubId && AppState.clubRegistry ? AppState.clubRegistry[clubId] : null;
                const currentList = clubId ? AppState.getRegularMembersForYear(clubId, activeY) : [];
                if (!club || currentList.length === 0) return;
                if (typeof global.showConfirmModal === 'function') {
                    global.showConfirmModal(`'${club.name}' (${activeY}년) 등록 정회원(${currentList.length}명)을 모두 삭제하시겠습니까?`, async () => {
                        await AppState.setClubRegularMembers(clubId, [], activeY);
                        renderRegularMembersList();
                        if (typeof global.renderClubManagement === 'function') global.renderClubManagement();
                    });
                }
            });
        }
    };
})(window);
