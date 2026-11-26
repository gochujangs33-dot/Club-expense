// ============================================================
// js/settlement-history.js — 정산 이력 유틸리티 · 수정 · 확정 · 중복체크 엔진
// ============================================================
// v1.7.64: app.js 에서 분리 (AGENTS.md §1-6 불변량 보존)
//   - updateHistoryEntry: clubRegistry.usedBudget / .prizeUsed 차액(delta) 보정
//   - finalizeSettlement: allowOverLimitSupport / allowFacilityFullBudget 정산당 1회성 무조건 리셋
//   - extractValidGlobalHistory: deletedHistoryIds 양방향 필터링 및 좀비 노드 정리

// 로컬 시간대(한국 시간 KST 포함) 기준 YYYY-MM-DD 포맷 헬퍼 (UTC 날짜 어긋남 방지)
function formatLocalDateYMD(dateInput = new Date()) {
    const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (Number.isNaN(d.getTime())) return '';
    return [
        d.getFullYear(),
        String(d.getMonth() + 1).padStart(2, '0'),
        String(d.getDate()).padStart(2, '0')
    ].join('-');
}
window.formatLocalDateYMD = formatLocalDateYMD;

// 정산 이력 호환 헬퍼: 신규 이력의 명시 필드와 구버전 expenseItems 구조를 모두 지원한다.
function getHistoryPrizeCost(entry) {
    if (!entry || typeof entry !== 'object') return 0;
    const items = Array.isArray(entry.expenseItems) ? entry.expenseItems : [];
    if (items.length > 0) {
        return items.reduce((sum, item) => {
            if (!item || item.category !== ExpenseCategory.PRIZE) return sum;
            return sum + Math.max(0, parseAmount(item.amount));
        }, 0);
    }
    return Math.max(0, parseAmount(entry.prizeCost));
}

// 정산 이력 행사 사진 호환 헬퍼: 다중 사진(eventPhotos) + 구버전 단일 사진(eventPhoto)
function getHistoryEventPhotos(entry) {
    if (!entry || typeof entry !== 'object') return [];
    if (Array.isArray(entry.eventPhotos)) return entry.eventPhotos.filter(Boolean);
    if (entry.eventPhotos) return [entry.eventPhotos];
    if (entry.eventPhoto) return [entry.eventPhoto];
    return [];
}

function getHistoryEntryYear(entry) {
    if (!entry || typeof entry !== 'object') return NaN;
    if (entry.settlementDate && /^\d{4}/.test(entry.settlementDate)) {
        return parseInt(entry.settlementDate.slice(0, 4), 10);
    }
    const rawDate = entry.date || (entry.id ? Number(entry.id) : null);
    const date = rawDate ? new Date(rawDate) : null;
    return date && !Number.isNaN(date.getTime()) ? date.getFullYear() : NaN;
}

// 실제 정산일 우선 최신순 정렬. 같은 정산일이면 저장 시각(id)이 최신인 항목을 먼저 표시한다.
function compareHistoryEntriesNewestFirst(a, b) {
    const dateKey = entry => {
        if (!entry || typeof entry !== 'object') return '';
        if (typeof entry.settlementDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(entry.settlementDate)) {
            return entry.settlementDate.slice(0, 10);
        }
        const rawDate = entry.date || (entry.id ? Number(entry.id) : null);
        const savedDate = rawDate ? new Date(rawDate) : null;
        if (!savedDate || Number.isNaN(savedDate.getTime())) return '';
        return [
            savedDate.getFullYear(),
            String(savedDate.getMonth() + 1).padStart(2, '0'),
            String(savedDate.getDate()).padStart(2, '0')
        ].join('-');
    };
    const dateDiff = dateKey(b).localeCompare(dateKey(a));
    if (dateDiff !== 0) return dateDiff;
    return (Number(b && b.id) || 0) - (Number(a && a.id) || 0);
}

// Firebase Realtime Database에 Base64 문자열로 보관하는 첨부파일의 용량 정책.
// 영수증은 글자를 읽을 수 있는 수준을 유지하고, 행사 사진은 화면·엑셀 표시용 저용량으로 제한한다.
const MediaStoragePolicy = Object.freeze({
    receipt: { maxDimension: 1280, minDimension: 640, targetBytes: 120 * 1024, quality: 0.68, minQuality: 0.42 },
    event: { maxDimension: 960, minDimension: 480, targetBytes: 70 * 1024, quality: 0.62, minQuality: 0.40 },
    feedback: { maxDimension: 800, minDimension: 400, targetBytes: 80 * 1024, quality: 0.62, minQuality: 0.42 },
    // Base64 문자열 기준 약 6MB: Firebase 단일 write 한도보다 충분히 낮게 유지한다.
    maxSettlementBytes: 6 * 1024 * 1024
});

function getMediaDataSize(value) {
    return typeof value === 'string' && value.startsWith('data:image/') ? value.length : 0;
}

function hasReceiptMedia(item) {
    return !!(item && (item.receiptImage || item.corporateReceiptImage || item.personalReceiptImage));
}

function getHistoryExpenseItems(entry) {
    if (!entry || typeof entry !== 'object' || !entry.expenseItems) return [];
    return Array.isArray(entry.expenseItems) ? entry.expenseItems : Object.values(entry.expenseItems);
}

function hasHistoryMedia(entry) {
    if (!entry || typeof entry !== 'object') return false;
    const eventPhotos = getHistoryEventPhotos(entry);
    return eventPhotos.length > 0 || getHistoryExpenseItems(entry).some(hasReceiptMedia);
}

// 개인 이력·로컬 백업에는 첨부 원본을 중복 저장하지 않는다.
// 확정 이력의 첨부 원본은 globalHistory가 단일 기준이며, 필요 시 다운로드 시점에 불러온다.
function stripHistoryMedia(entry) {
    if (!entry || typeof entry !== 'object') return entry;
    const cleaned = { ...entry };
    delete cleaned.eventPhotos;
    delete cleaned.eventPhoto;
    const cleanItem = item => {
        if (!item || typeof item !== 'object') return item;
        const copy = { ...item };
        delete copy.receiptImage;
        delete copy.corporateReceiptImage;
        delete copy.personalReceiptImage;
        return copy;
    };
    if (Array.isArray(cleaned.expenseItems)) {
        cleaned.expenseItems = cleaned.expenseItems.map(cleanItem);
    } else if (cleaned.expenseItems && typeof cleaned.expenseItems === 'object') {
        cleaned.expenseItems = Object.fromEntries(Object.entries(cleaned.expenseItems)
            .map(([key, item]) => [key, cleanItem(item)]));
    }
    return cleaned;
}

// 정산 연도가 끝난 뒤 다음 해 4월 1일부터 해당 연도의 첨부만 자동 정리한다.
function isHistoryMediaExpired(entry, now = new Date()) {
    const entryYear = getHistoryEntryYear(entry);
    if (!Number.isInteger(entryYear)) return false;
    return now >= new Date(entryYear + 1, 3, 1);
}

function historyMatchesClub(entry, clubId, clubName) {
    if (!entry || typeof entry !== 'object') return false;
    const targetId = clubId === null || clubId === undefined ? '' : String(clubId);
    const entryId = entry.clubId === null || entry.clubId === undefined ? '' : String(entry.clubId);
    if (targetId && entryId && targetId === entryId) return true;
    return !!clubName && entry.clubName === clubName;
}

// 정산 이력이 시설비 전액 승인 또는 85,000원 초과 지원 승인을 받아 저장된 건인지 판별
// (신규 이력은 명시 플래그, 기존 구버전 이력은 저장된 항목의 법인카드 합계와 당시 한도로 역추적)
function hasFacilityFullApprovalInEntry(entry) {
    if (!entry || typeof entry !== 'object') return false;
    if (entry.facilityFullApproved === true) return true;
    const memberCount = Number(entry.memberCount) || (Array.isArray(entry.attendees) ? entry.attendees.length : 0);
    if (memberCount <= 0) return false;
    const limit = (entry.rules && Number(entry.rules.facilityLimit)) || 85000;
    const facilityCorpSum = getHistoryExpenseItems(entry)
        .filter(item => item && item.category === 'FACILITY')
        .reduce((sum, item) => sum + Math.max(0, Number(item.corporateAmount) || 0), 0);
    return facilityCorpSum > memberCount * limit;
}

function hasOverLimitApprovalInEntry(entry) {
    if (!entry || typeof entry !== 'object') return false;
    if (entry.overLimitApproved === true) return true;
    const memberCount = Number(entry.memberCount) || (Array.isArray(entry.attendees) ? entry.attendees.length : 0);
    if (memberCount <= 0) return false;
    const cap = (entry.rules && Number(entry.rules.deduction4)) || 85000;
    const eventCorpSum = getHistoryExpenseItems(entry)
        .filter(item => item && item.category === 'EVENT')
        .reduce((sum, item) => sum + Math.max(0, Number(item.corporateAmount) || 0), 0);
    return eventCorpSum > memberCount * cap;
}

// globalHistory 스냅샷(키-값 맵)에서 deletedHistoryIds(키 및 entry.id 양쪽)와 불완전 좀비 노드를 제거하고
// entry.id 가 누락된 정상 엔트리는 Firebase 키로 정규화해 사용자/관리자 화면 이력을 100% 일치시킨다.
function extractValidGlobalHistory(historyData, deletedMap, db = null) {
    const rawMap = (historyData && typeof historyData === 'object') ? historyData : {};
    const delMap = (deletedMap && typeof deletedMap === 'object') ? deletedMap : {};
    const result = [];
    const seenIds = new Set();
    const zombieCleanup = {};

    Object.entries(rawMap).forEach(([key, entry]) => {
        if (!entry || typeof entry !== 'object') return;
        const keyStr = String(key);
        const entryIdStr = (entry.id !== undefined && entry.id !== null) ? String(entry.id) : '';
        if (delMap[keyStr] || (entryIdStr && delMap[entryIdStr])) {
            // 이미 삭제된 항목(deletedHistoryIds에 존재)이 globalHistory에 좀비 노드로 남아 있으면 자동 정리
            zombieCleanup[`globalHistory/${keyStr}`] = null;
            return;
        }
        if (!entry.settlementDate && !entry.date) return;
        const normalizedId = (entry.id !== undefined && entry.id !== null && String(entry.id) !== '')
            ? entry.id
            : (/^\d+$/.test(keyStr) ? Number(keyStr) : keyStr);
        const normIdStr = String(normalizedId);
        if (seenIds.has(normIdStr)) return;
        seenIds.add(normIdStr);
        if (entry.id === undefined || entry.id === null) {
            entry = { ...entry, id: normalizedId };
        }
        result.push(entry);
    });

    if (db && Object.keys(zombieCleanup).length > 0) {
        try {
            db.ref().update(zombieCleanup).catch(() => {});
        } catch (_) {}
    }
    return result;
}
window.extractValidGlobalHistory = extractValidGlobalHistory;

window.__installSettlementHistory = function (targetAppState) {
    if (!targetAppState || typeof targetAppState !== 'object') return;

    Object.assign(targetAppState, {
        // 이력 항목을 현재 정산 폼으로 복원 (수정 모드 진입)
        async loadHistoryEntryForEdit(entry) {
            if (!this.isLoggedIn) {
                throw new Error('로그인 후 정산 이력을 수정할 수 있습니다.');
            }
            if (!entry || typeof entry !== 'object' || !entry.id) {
                console.error('loadHistoryEntryForEdit: 유효하지 않은 이력 항목', entry);
                return;
            }
            entry = await this.hydrateHistoryMedia(entry);
            this.editingHistoryId = entry.id;
            // 과거 정산 건에 저장된 규칙(rules) 스냅샷이 있으면 해당 규칙으로 임시 전환 (과거 구간표 기준 유지)
            if (entry.rules) {
                this._backupRulesBeforeEdit = JSON.parse(JSON.stringify(this.rules));
                this.rules = JSON.parse(JSON.stringify(entry.rules));
            }
            // 관리자 전체 요약에서 연 이력은 현재 clubHistory에 없을 수 있다. 저장 시에도 동일한
            // 수정 전 값을 기준으로 차액을 계산할 수 있도록 원본을 별도로 보관한다.
            this._editingHistoryOriginal = JSON.parse(JSON.stringify(entry));
            // 이 이력이 원래 기여했던 지원금·상품비 — 예산 한도 검사 시 "이미 사용한 금액"에서
            // 이 항목 자신의 몫을 빼줘야 수정 중 재검증이 자기 자신과 충돌해 잔여예산 초과로 막히지 않음
            this._editingOriginalSupport = entry.finalSupportAmount || 0;
            this._editingOriginalPrize = (entry.expenseItems || [])
                .filter(i => i.category === 'PRIZE')
                .reduce((s, i) => s + (i.amount || 0), 0);
            this._editingFacilityFullApproved = hasFacilityFullApprovalInEntry(entry);
            this._editingOverLimitApproved = hasOverLimitApprovalInEntry(entry);
            this.expenseItems = JSON.parse(JSON.stringify(entry.expenseItems || []));
            this.attendees = JSON.parse(JSON.stringify(entry.attendees || []));
            this.eventPhotos = JSON.parse(JSON.stringify(getHistoryEventPhotos(entry)));
            // memberCount가 없으면 attendees 수로 보완 (구버전 데이터 호환)
            this.memberCount = entry.memberCount || (entry.attendees ? entry.attendees.length : 0);
            this.nonMemberCount = Math.max(0, parseInt(entry.nonMemberCount, 10) || 0);
            this.eventNote = entry.eventNote ? String(entry.eventNote) : '';
            if (this.eventNote && !['온라인', '가족 행사'].includes(this.eventNote) && !(this.customNoteOptions || []).includes(this.eventNote)) {
                this.customNoteOptions = [...(this.customNoteOptions || []), this.eventNote];
            }
            if (entry.clubName) this.clubName = entry.clubName;
            // clubId 없는 구버전 데이터: 이름으로 역조회해서 복원
            if (entry.clubId) {
                this.clubId = entry.clubId;
            } else if (entry.clubName) {
                const match = Object.entries(this.clubRegistry || {}).find(([, c]) => c.name === entry.clubName);
                this.clubId = match ? match[0] : '';
            }
            // 수정 대상의 기존 상품비는 이미 확정 누적액에 포함돼 있다. 수정 중에는 이 항목 몫을
            // 제외한 "다른 이력의 누적액"만 기준으로 계산해야 260,000원 → 264,000원이 524,000원으로
            // 합산되지 않고 실제 차액(+4,000원)만 반영된다.
            const editingClub = this.clubId ? this.clubRegistry[this.clubId] : null;
            const registeredPrizeUsed = editingClub ? (editingClub.prizeUsed || 0) : this.previousPrizeTotal;
            this.previousPrizeTotal = Math.max(0, registeredPrizeUsed - this._editingOriginalPrize);
            // 이력에 저장된 "실제" 자부담을 그대로 불러옴(오버라이드로 취급) — 항목을 건드리기 전까지는
            // 항목 합계로 재계산하지 않고 저장된 값을 그대로 유지 (과거에 수동 조정했던 값도 보존됨)
            this.lastCalculatedSelfPay = entry.totalSelfPay || 0;
            this.selfPayManuallyOverridden = true;
            // 정산 날짜 입력란을 이력 원본 날짜로 복원 (_onSettleDateChange: 특정 날짜 지정)
            if (entry.settlementDate) {
                if (typeof window._onSettleDateChange === 'function') {
                    window._onSettleDateChange(entry.settlementDate);
                } else {
                    const _sdiEdit = document.getElementById('settlement-date-input');
                    if (_sdiEdit) _sdiEdit.value = entry.settlementDate;
                }
            }
            // 수정 모드에서는 우측 하단 "정산 완료" 버튼을 "수정 완료"로 전환하고 아래에 "수정 취소" 버튼 표시
            const _sendEmailBtn = document.getElementById('send-email-btn');
            if (_sendEmailBtn) {
                _sendEmailBtn.classList.remove('hidden');
                _sendEmailBtn.innerHTML = `<span class="btn-icon">✅</span> 수정 완료`;
            }
            const _editCancelBtn = document.getElementById('edit-mode-cancel-btn');
            if (_editCancelBtn) _editCancelBtn.classList.remove('hidden');
            // 수정 모드 배너 표시
            const banner = document.getElementById('edit-mode-banner');
            const dateEl = document.getElementById('edit-mode-date');
            if (banner) banner.classList.remove('hidden');
            if (dateEl) {
                const d = new Date(entry.date);
                dateEl.textContent = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
            }
            // 정산 탭으로 전환
            document.querySelectorAll('.tab-nav .tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
            const settlementTab = document.querySelector('[data-tab="tab-settlement"]');
            const settlementPane = document.getElementById('tab-settlement');
            if (settlementTab) settlementTab.classList.add('active');
            if (settlementPane) settlementPane.classList.remove('hidden');
            this.render();
        },

        // 수정된 항목으로 이력 엔트리 업데이트 (Firebase globalHistory + 개인 settlementHistory + 클럽 예산 보정)
        async updateHistoryEntry(id, updatedFields) {
            // clubHistory(클럽 전체 이력)에서 우선 조회 — 관리자가 다른 회원이 작성한 이력을 수정하는 경우도 포함
            const clubIdx = (this.clubHistory || []).findIndex(e => String(e.id) === String(id));
            const personalEntry = (this.settlementHistory || []).find(e => String(e.id) === String(id));
            const editingOriginal = this._editingHistoryOriginal
                && String(this._editingHistoryOriginal.id) === String(id)
                ? this._editingHistoryOriginal
                : null;
            // 관리자 전체 요약 → 수정 화면 진입 시에는 clubHistory/개인 이력에 없는 항목도 있으므로,
            // 수정 시작 때 보관한 원본을 마지막 조회 기준으로 사용한다.
            const oldEntry = clubIdx >= 0 ? this.clubHistory[clubIdx] : (personalEntry || editingOriginal);
            if (!oldEntry) throw new Error('수정할 정산 이력을 찾을 수 없습니다.');

            const editedAt = new Date().toISOString();
            // 영수증·행사 사진은 메일로 백업하므로 Firebase DB에는 저장하지 않는다.
            const sanitizedFields = stripHistoryMedia(updatedFields || {});
            const merged = stripHistoryMedia({ ...oldEntry, ...sanitizedFields, mediaStoredInGlobal: false, isEdited: true, editedAt });
            const ownIdx = (this.settlementHistory || []).findIndex(e => String(e.id) === String(id));
            const nextSettlementHistory = ownIdx >= 0
                ? this.settlementHistory.map((entry, index) => index === ownIdx ? merged : entry)
                : null;
            const sumPrize = items => (items || []).reduce((s, it) => s + (it.category === 'PRIZE' ? (it.amount || 0) : 0), 0);
            const oldPrize = sumPrize(oldEntry.expenseItems);
            const newPrize = sumPrize(merged.expenseItems);
            const clubId = merged.clubId || (Object.entries(this.clubRegistry || {}).find(([, c]) => c.name === merged.clubName) || [])[0];
            const club = clubId ? this.clubRegistry[clubId] : null;
            const deltaSupport = (merged.finalSupportAmount || 0) - (oldEntry.finalSupportAmount || 0);
            const deltaPrize = newPrize - oldPrize;
            const creatorPin = merged.creatorPin || oldEntry.creatorPin;
            let persistedClub = null;
            const ownPersonalDirectory = nextSettlementHistory
                ? this.buildDirectoryCountsForHistory(nextSettlementHistory)
                : null;
            let nextGlobalDirectory = null;
            const pendingGlobalDirUpdates = {};
            let creatorHistory = null;
            let creatorDirectory = null;

            try {
                if (this.firebaseDb) {
                    // 일반 회원·관리자 어느 화면에서 수정하든 전체 공유 이력(globalHistory) 기준으로 공유 명부 누적 횟수를 정확히 재계산한다.
                    const [historySnapshot, deletedSnapshot] = await Promise.all([
                        this.firebaseDb.ref('globalHistory').once('value'),
                        this.firebaseDb.ref('deletedHistoryIds').once('value')
                    ]);
                    const deletedIds = new Set(Object.keys(deletedSnapshot.val() || {}));
                    if (deletedIds.has(String(id))) {
                        throw new Error('이미 삭제된 정산 이력은 수정할 수 없습니다.');
                    }
                    const globalHistory = [];
                    historySnapshot.forEach(child => {
                        if (deletedIds.has(String(child.key))) return;
                        const historyEntry = child.val();
                        if (!historyEntry || (historyEntry.id !== undefined && deletedIds.has(String(historyEntry.id)))) return;
                        globalHistory.push(String(historyEntry.id || child.key) === String(id) ? merged : historyEntry);
                    });
                    nextGlobalDirectory = typeof this.prepareGlobalDirectorySync === 'function'
                        ? await this.prepareGlobalDirectorySync(globalHistory, pendingGlobalDirUpdates)
                        : this.buildDirectoryCountsForHistory(globalHistory);

                    // 다른 회원이 공유 이력을 수정해도 원 작성자의 개인 이력과 참석 누적 횟수는
                    // 함께 갱신한다. 현재 로그인 계정의 명부에 타인의 이력을 섞지 않는다.
                    if (creatorPin && String(creatorPin) !== String(this.currentPin)) {
                        const creatorSnapshot = await this.firebaseDb.ref(`settlements/${creatorPin}`).once('value');
                        const creatorData = creatorSnapshot.val() || {};
                        const rawHistory = creatorData.settlementHistory;
                        if (rawHistory) {
                            const historyArray = Array.isArray(rawHistory) ? rawHistory : Object.values(rawHistory);
                            const creatorIndex = historyArray.findIndex(entry => entry && String(entry.id) === String(id));
                            if (creatorIndex >= 0) {
                                creatorHistory = historyArray.map((entry, index) => index === creatorIndex ? merged : entry);
                                if (creatorData.directory) {
                                    creatorDirectory = this.buildDirectoryCountsForHistory(
                                        creatorHistory,
                                        creatorData.directory
                                    );
                                }
                            }
                        }
                    }

                    // 공유 이력·개인 이력·클럽 누적액을 한 번의 원자적 update로 저장한다.
                    // 누적액은 서버 증분을 사용해 동시 수정/정산이 서로의 값을 덮어쓰지 않게 한다.
                    const firebaseUpdates = {};
                    const globalUpdate = { id: merged.id, ...sanitizedFields, mediaStoredInGlobal: false, isEdited: true, editedAt, eventPhotos: null, eventPhoto: null };
                    Object.entries(globalUpdate).forEach(([key, value]) => {
                        firebaseUpdates[`globalHistory/${id}/${key}`] = value;
                    });
                    // 현재 로그인 계정이 보유한 개인 이력이면 해당 배열도 갱신한다.
                    // 관리자가 다른 작성자의 이력을 수정하는 경우에는 위에서 그 작성자 데이터만 직접 읽어 별도로 동기화한다.
                    if (nextSettlementHistory && this.currentPin) {
                        firebaseUpdates[`settlements/${this.currentPin}/settlementHistory`] = this.buildPersonalHistoryForSync(nextSettlementHistory);
                    }
                    if (ownPersonalDirectory && this.currentPin) {
                        firebaseUpdates[`settlements/${this.currentPin}/directory`] = ownPersonalDirectory;
                    }
                    if (Object.keys(pendingGlobalDirUpdates).length > 0) {
                        Object.assign(firebaseUpdates, pendingGlobalDirUpdates);
                    } else if (nextGlobalDirectory) {
                        firebaseUpdates['settlements/000000/directory'] = nextGlobalDirectory;
                    }
                    if (creatorHistory && creatorPin) {
                        firebaseUpdates[`settlements/${creatorPin}/settlementHistory`] = this.buildPersonalHistoryForSync(creatorHistory);
                    }
                    if (creatorDirectory && creatorPin) {
                        firebaseUpdates[`settlements/${creatorPin}/directory`] = creatorDirectory;
                    }
                    // 클럽 예산·상품비는 반드시 수정 전/후 차액(delta)만 반영한다.
                    if (club) {
                        const entryYearKey = String(merged.settlementYear || parseInt((merged.settlementDate || '').slice(0, 4), 10) || new Date().getFullYear());
                        const hasYearlyEntrySnapshot = Boolean(
                            this.yearlyClubRegistry
                            && this.yearlyClubRegistry[entryYearKey]
                            && this.yearlyClubRegistry[entryYearKey][clubId]
                        );
                        if (deltaSupport !== 0) {
                            firebaseUpdates[`clubRegistry/${clubId}/usedBudget`] = firebase.database.ServerValue.increment(deltaSupport);
                            if (hasYearlyEntrySnapshot) {
                                firebaseUpdates[`yearlyClubRegistry/${entryYearKey}/${clubId}/usedBudget`] = firebase.database.ServerValue.increment(deltaSupport);
                                this.yearlyClubRegistry[entryYearKey][clubId].usedBudget = (this.yearlyClubRegistry[entryYearKey][clubId].usedBudget || 0) + deltaSupport;
                            }
                        }
                        if (deltaPrize !== 0) {
                            firebaseUpdates[`clubRegistry/${clubId}/prizeUsed`] = firebase.database.ServerValue.increment(deltaPrize);
                            if (hasYearlyEntrySnapshot) {
                                firebaseUpdates[`yearlyClubRegistry/${entryYearKey}/${clubId}/prizeUsed`] = firebase.database.ServerValue.increment(deltaPrize);
                                this.yearlyClubRegistry[entryYearKey][clubId].prizeUsed = (this.yearlyClubRegistry[entryYearKey][clubId].prizeUsed || 0) + deltaPrize;
                            }
                        }
                    }
                    this.appendAuditUpdate(firebaseUpdates, {
                        action: 'UPDATE',
                        targetType: '정산 수정',
                        targetId: id,
                        targetLabel: `${merged.clubName || '기본 클럽'} (${merged.settlementDate || ''})`.trim(),
                        summary: `정산 수정: '${merged.clubName || oldEntry.clubName || '기본 클럽'}' (${merged.settlementDate || oldEntry.settlementDate || ''}) · 총 ${SettlementCalculator.formatCurrency(merged.totalCost)} (지원금: ${SettlementCalculator.formatCurrency(merged.finalSupportAmount)}, 자부담: ${SettlementCalculator.formatCurrency(merged.totalSelfPay)})`.trim(),
                        clubId,
                        clubName: merged.clubName || oldEntry.clubName || '',
                        details: {
                            작성자: `${oldEntry.creatorName || '-'} (${oldEntry.creatorPin || '-'})`,
                            이전정산일: oldEntry.settlementDate || '',
                            변경정산일: merged.settlementDate || '',
                            이전총비용: oldEntry.totalCost || 0,
                            변경총비용: merged.totalCost || 0,
                            이전지원금: oldEntry.finalSupportAmount || 0,
                            변경지원금: merged.finalSupportAmount || 0,
                            이전자부담: oldEntry.totalSelfPay || 0,
                            변경자부담: merged.totalSelfPay || 0,
                            지원금차액: deltaSupport,
                            상품비차액: deltaPrize,
                            참석인원: merged.memberCount || 0
                        }
                    });
                    await this.firebaseDb.ref().update(firebaseUpdates);
                    if (club) {
                        try {
                            const clubSnapshot = await this.firebaseDb.ref(`clubRegistry/${clubId}`).once('value');
                            persistedClub = clubSnapshot.val();
                        } catch (readErr) {
                            console.warn('수정 후 클럽 누적값 재조회 실패:', readErr);
                        }
                    }
                }

                // 원격 저장이 끝난 뒤에만 로컬 캐시를 갱신한다.
                if (clubIdx >= 0) this.clubHistory[clubIdx] = merged;
                if (ownIdx >= 0) this.settlementHistory = nextSettlementHistory;
                if (nextGlobalDirectory) this.directory = nextGlobalDirectory;
                else if (ownPersonalDirectory) this.directory = ownPersonalDirectory;
                if (club) {
                    if (persistedClub) {
                        this.clubRegistry[clubId] = { ...club, ...persistedClub };
                    } else if (deltaSupport !== 0 || deltaPrize !== 0) {
                        const currentClub = this.clubRegistry[clubId] || club;
                        currentClub.usedBudget = Math.max(0, (currentClub.usedBudget || 0) + deltaSupport);
                        currentClub.prizeUsed = Math.max(0, (currentClub.prizeUsed || 0) + deltaPrize);
                    }
                }
                if (this._backupRulesBeforeEdit) {
                    this.rules = this._backupRulesBeforeEdit;
                    this._backupRulesBeforeEdit = null;
                }
                this.save(false);
                return merged;
            } catch (err) {
                console.error('이력 수정 저장 실패:', err);
                throw err;
            }
        },

        // 수정 모드 해제
        cancelEditMode() {
            if (this._backupRulesBeforeEdit) {
                this.rules = this._backupRulesBeforeEdit;
                this._backupRulesBeforeEdit = null;
            }
            this.editingHistoryId = null;
            this._editingHistoryOriginal = null;
            this._editingOriginalSupport = 0;
            this._editingOriginalPrize = 0;
            this._editingFacilityFullApproved = false;
            this._editingOverLimitApproved = false;
            const banner = document.getElementById('edit-mode-banner');
            if (banner) banner.classList.add('hidden');
            // 우측 하단 버튼 문구 원래("정산 완료")로 복원 및 수정 취소 버튼 숨기기
            const sendBtn = document.getElementById('send-email-btn');
            if (sendBtn) {
                sendBtn.classList.remove('hidden');
                sendBtn.innerHTML = `<span class="btn-icon">💾</span> 정산 완료`;
            }
            const editCancelBtn = document.getElementById('edit-mode-cancel-btn');
            if (editCancelBtn) editCancelBtn.classList.add('hidden');
            // 날짜를 오늘로 초기화
            if (typeof window._onSettleDateReset === 'function') window._onSettleDateReset();
        },

        // 관리자 DB(globalHistory) 실시간 조회하여 동일 클럽·동일 날짜 중복 정산 여부 확인
        async checkDuplicateSettlement(clubId, clubName, settlementDate) {
            const targetClubId = String(clubId || this.clubId || '').trim();
            const targetClubName = String(clubName || this.clubName || '').trim().toLowerCase();

            let targetDate = settlementDate;
            if (!targetDate) {
                const settleDateInput = document.getElementById('settlement-date-input');
                const settleDateVal = settleDateInput ? settleDateInput.value : '';
                targetDate = (settleDateVal || formatLocalDateYMD()).trim();
            } else {
                targetDate = String(targetDate).trim();
            }
            // YYYY-MM-DD 정규화
            const matchTarget = targetDate.match(/\d{4}-\d{2}-\d{2}/);
            if (matchTarget) targetDate = matchTarget[0];

            if (!targetDate || (!targetClubId && !targetClubName)) return null;

            const currentEditingId = this.editingHistoryId ? String(this.editingHistoryId) : null;

            // 1. 온라인: 관리자 DB(globalHistory + deletedHistoryIds) 실시간 조회
            if (this.firebaseDb) {
                try {
                    const [historySnap, deletedSnap] = await Promise.all([
                        this.firebaseDb.ref('globalHistory').once('value'),
                        this.firebaseDb.ref('deletedHistoryIds').once('value').catch(() => null)
                    ]);
                    const deletedIds = new Set(Object.keys(deletedSnap && deletedSnap.val() ? deletedSnap.val() : {}));

                    let duplicate = null;
                    historySnap.forEach(child => {
                        if (duplicate) return true;
                        const key = String(child.key);
                        if (deletedIds.has(key)) return;
                        if (currentEditingId && key === currentEditingId) return;

                        const entry = child.val();
                        if (!entry) return;
                        if (currentEditingId && String(entry.id) === currentEditingId) return;

                        let entryDate = String(entry.settlementDate || (entry.date ? entry.date.slice(0, 10) : '')).trim();
                        const matchEntry = entryDate.match(/\d{4}-\d{2}-\d{2}/);
                        if (matchEntry) entryDate = matchEntry[0];

                        if (entryDate !== targetDate) return;

                        const entryClubId = String(entry.clubId || '').trim();
                        const entryClubName = String(entry.clubName || '').trim().toLowerCase();

                        const isMatch = (targetClubId && entryClubId && targetClubId === entryClubId)
                            || (targetClubName && entryClubName && targetClubName === entryClubName);

                        if (isMatch) {
                            duplicate = {
                                id: entry.id || key,
                                clubId: entryClubId || targetClubId,
                                clubName: entry.clubName || targetClubName,
                                settlementDate: entryDate,
                                creatorName: entry.creatorName || '기존 등록자',
                                creatorPin: entry.creatorPin || '',
                                totalCost: entry.totalCost || 0,
                                finalSupportAmount: entry.finalSupportAmount || 0,
                                totalSelfPay: entry.totalSelfPay || 0,
                                memberCount: entry.memberCount || 0
                            };
                        }
                    });

                    if (duplicate) return duplicate;
                } catch (err) {
                    console.warn('관리자 DB globalHistory 중복 확인 조회 실패, 로컬 이력으로 폴백:', err);
                }
            }

            // 2. 오프라인 또는 폴백: 로컬 settlementHistory 및 clubHistory 확인
            const localList = [...(this.settlementHistory || []), ...(this.clubHistory || [])];
            const checkedIds = new Set();
            for (const entry of localList) {
                if (!entry) continue;
                const entryId = String(entry.id || '');
                if (checkedIds.has(entryId)) continue;
                checkedIds.add(entryId);

                if (currentEditingId && entryId === currentEditingId) continue;

                let entryDate = String(entry.settlementDate || (entry.date ? entry.date.slice(0, 10) : '')).trim();
                const matchEntry = entryDate.match(/\d{4}-\d{2}-\d{2}/);
                if (matchEntry) entryDate = matchEntry[0];

                if (entryDate !== targetDate) continue;

                const entryClubId = String(entry.clubId || '').trim();
                const entryClubName = String(entry.clubName || '').trim().toLowerCase();
                const isMatch = (targetClubId && entryClubId && targetClubId === entryClubId)
                    || (targetClubName && entryClubName && targetClubName === entryClubName);

                if (isMatch) {
                    return {
                        id: entry.id,
                        clubId: entryClubId || targetClubId,
                        clubName: entry.clubName || targetClubName,
                        settlementDate: entryDate,
                        creatorName: entry.creatorName || '기존 등록자',
                        creatorPin: entry.creatorPin || '',
                        totalCost: entry.totalCost || 0,
                        finalSupportAmount: entry.finalSupportAmount || 0,
                        totalSelfPay: entry.totalSelfPay || 0,
                        memberCount: entry.memberCount || 0
                    };
                }
            }

            return null;
        },

        // 중복 정산 감지 시 안내 에러 팝업 표시 (인앱 커스텀 모달 우선 표시)
        showDuplicateSettlementAlert(duplicate) {
            if (!duplicate) return;
            const clubText = duplicate.clubName || this.clubName || '선택된 클럽';
            const dateText = duplicate.settlementDate || '';
            const creatorText = duplicate.creatorName ? `• 기존 등록자: ${duplicate.creatorName}\n` : '';
            const amountText = duplicate.totalCost
                ? `• 기존 정산 금액: ${formatAmount(duplicate.totalCost)}원 (회사 지원금: ${formatAmount(duplicate.finalSupportAmount || 0)}원)\n`
                : '';

            const msg =
                `이미 동일한 날짜로 등록된 정산 내역이 존재합니다.\n\n` +
                `• 대상 클럽: ${clubText}\n` +
                `• 정산 날짜: ${dateText}\n` +
                creatorText +
                amountText +
                `\n동일한 클럽은 같은 날짜에 중복으로 정산을 등록할 수 없습니다.\n` +
                `정산 날짜를 변경하시거나 [정산 이력] 탭에서 기존 내역을 확인해 주세요.`;

            if (typeof showConfirmModal === 'function') {
                showConfirmModal(msg, null, '확인', '중복 정산 날짜 알림', '🚨');
            } else {
                alert(`🚨 [정산 등록 불가 - 중복 정산 감지]\n\n` + msg);
            }
        },

        async finalizeSettlement(skipConfirm = false) {
            if (!this.hasSelectedClub()) {
                alert('먼저 상단에서 정산할 클럽을 선택해 주세요.');
                const clubSel = document.getElementById('club-name-select');
                if (clubSel) {
                    clubSel.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    clubSel.focus();
                }
                return false;
            }
            if (this.editingHistoryId) {
                alert('수정 모드에서는 엑셀 다운로드 시 이력이 업데이트됩니다. 수정을 취소하려면 "수정 취소" 버튼을 누르세요.');
                return false;
            }

            // 사용자가 지정한 정산 날짜 (미입력 시 오늘)
            const settleDateInput = document.getElementById('settlement-date-input');
            const settleDateVal = settleDateInput ? settleDateInput.value : '';
            const settlementDate = (settleDateVal || formatLocalDateYMD()).trim();

            // ── 관리자 DB 중복 정산 검증 (동일 클럽 + 동일 날짜 차단) ──
            const duplicate = await this.checkDuplicateSettlement(this.clubId, this.clubName, settlementDate);
            if (duplicate) {
                this.showDuplicateSettlementAlert(duplicate);
                return false;
            }

            if (!skipConfirm) {
                const confirmed = await new Promise((resolve) => {
                    if (typeof showConfirmModal === 'function') {
                        showConfirmModal(
                            t('confirm.finalize_settlement'),
                            () => resolve(true),
                            '정산 확정',
                            '정산 확정 확인',
                            '💾',
                            () => resolve(false)
                        );
                    } else {
                        resolve(confirm(t('confirm.finalize_settlement')));
                    }
                });
                if (!confirmed) return false;
            }
            if (this._finalizeInProgress) return false;
            this._finalizeInProgress = true;

            try {
                const result = SettlementCalculator.calculate(
                    this.memberCount, this.expenseItems, this.previousPrizeTotal, this.rules
                );

                // Use manually adjusted self-pay if user changed it, otherwise use item-based sum (v1.6.215+)
                const finalTotalSelfPay = this.selfPayManuallyOverridden ? this.lastCalculatedSelfPay : Math.round(result.itemSelfPay);
                const finalPerPersonSelfPay = this.memberCount > 0 ? finalTotalSelfPay / this.memberCount : result.perPersonSelfPay;
                const finalSelfPayRatio = result.totalCost > 0 ? finalTotalSelfPay / result.totalCost : 0;

                const rawEventPhotoCount = Array.isArray(this.eventPhotos) ? this.eventPhotos.length : 0;
                const newHistoryItem = stripHistoryMedia({
                    id: Date.now(),
                    date: new Date().toISOString(),
                    settlementDate,
                    creatorPin: this.currentPin || "offline",
                    creatorName: this.userName || "오프라인 사용자",
                    clubName: this.clubName || "기본 클럽",
                    clubId: this.clubId || '',
                    memberCount: this.memberCount,
                    nonMemberCount: this.nonMemberCount || 0,
                    eventNote: this.eventNote || '',
                    totalCost: result.totalCost,
                    prizeCost: result.prizeCost,
                    finalSupportAmount: result.totalCost - finalTotalSelfPay,
                    totalSelfPay: finalTotalSelfPay,
                    perPersonSelfPay: finalPerPersonSelfPay,
                    selfPayRatio: finalSelfPayRatio,
                    expenseItems: JSON.parse(JSON.stringify(this.expenseItems)),
                    attendees: JSON.parse(JSON.stringify(this.attendees)),
                    // 영수증·행사 사진은 메일로 백업하므로 Firebase DB에는 저장하지 않는다.
                    mediaStoredInGlobal: false,
                    // 정산 당시 1회 승인 여부 보존 (추후 이력 수정 시에도 동일 승인 상태 유지)
                    facilityFullApproved: Boolean(this.clubId && this.clubRegistry && this.clubRegistry[this.clubId] && this.clubRegistry[this.clubId].allowFacilityFullBudget),
                    overLimitApproved: Boolean(this.clubId && this.clubRegistry && this.clubRegistry[this.clubId] && this.clubRegistry[this.clubId].allowOverLimitSupport),
                    // 정산 당시의 정산 규칙(구간/비율) 스냅샷 영구 보존 — 새해에 rules가 변경되어도 과거 데이터 고정 (v1.6.320)
                    rules: JSON.parse(JSON.stringify(this.rules || DefaultRules)),
                    settlementYear: parseInt(settlementDate.slice(0, 4), 10) || new Date().getFullYear(),
                });
                const nextSettlementHistory = [newHistoryItem, ...(this.settlementHistory || [])];
                const nextPersonalDirectory = this.buildDirectoryCountsForHistory(nextSettlementHistory);
                let nextGlobalDirectory = null;
                const pendingGlobalDirUpdates = {};
                const prizeThisSession = result.prizeCost || 0;
                const registryClub = this.clubId ? this.clubRegistry[this.clubId] : null;
                let persistedClub = null;

                // 공유 이력·개인 이력·세션 초기화·클럽 누적액을 한 번에 저장한다.
                // 쓰기가 실패하면 아래 로컬 초기화 구간에 도달하지 않으므로 입력 내용이 그대로 유지된다.
                if (this.isLoggedIn && this.firebaseDb) {
                    try {
                        const [historySnapshot, deletedSnapshot] = await Promise.all([
                            this.firebaseDb.ref('globalHistory').once('value'),
                            this.firebaseDb.ref('deletedHistoryIds').once('value')
                        ]);
                        const deletedIds = new Set(Object.keys(deletedSnapshot.val() || {}));
                        const globalHistoryWithNew = [newHistoryItem];
                        historySnapshot.forEach(child => {
                            if (deletedIds.has(String(child.key))) return;
                            const historyEntry = child.val();
                            if (!historyEntry || String(historyEntry.id) === String(newHistoryItem.id)) return;
                            globalHistoryWithNew.push(historyEntry);
                        });
                        nextGlobalDirectory = typeof this.prepareGlobalDirectorySync === 'function'
                            ? await this.prepareGlobalDirectorySync(globalHistoryWithNew, pendingGlobalDirUpdates)
                            : this.buildDirectoryCountsForHistory(globalHistoryWithNew);
                    } catch (dirErr) {
                        console.warn('정산 확정 시 공유 명부 누적 재계산 실패, 개인 명부로 폴백:', dirErr);
                    }

                    const firebaseUpdates = {
                        [`globalHistory/${newHistoryItem.id}`]: newHistoryItem,
                    };
                    if (Object.keys(pendingGlobalDirUpdates).length > 0) {
                        Object.assign(firebaseUpdates, pendingGlobalDirUpdates);
                    } else if (nextGlobalDirectory) {
                        firebaseUpdates['settlements/000000/directory'] = nextGlobalDirectory;
                    }
                    if (this.currentPin) {
                        const settlementPath = `settlements/${this.currentPin}`;
                        firebaseUpdates[`${settlementPath}/memberCount`] = 0;
                        firebaseUpdates[`${settlementPath}/nonMemberCount`] = 0;
                        firebaseUpdates[`${settlementPath}/eventNote`] = '';
                        firebaseUpdates[`${settlementPath}/expenseItems`] = [];
                        firebaseUpdates[`${settlementPath}/attendees`] = [];
                        firebaseUpdates[`${settlementPath}/directory`] = nextPersonalDirectory;
                        firebaseUpdates[`${settlementPath}/settlementHistory`] = this.buildPersonalHistoryForSync(nextSettlementHistory);
                        firebaseUpdates[`${settlementPath}/eventPhotos`] = null;
                        firebaseUpdates[`${settlementPath}/lastUpdated`] = firebase.database.ServerValue.TIMESTAMP;
                    }
                    if (registryClub) {
                        firebaseUpdates[`clubRegistry/${this.clubId}/usedBudget`] = firebase.database.ServerValue.increment(newHistoryItem.finalSupportAmount);
                        firebaseUpdates[`clubRegistry/${this.clubId}/prizeUsed`] = firebase.database.ServerValue.increment(prizeThisSession);
                        // 85,000원 초과 승인 및 시설비 전액 승인은 정산 1건마다 무조건 해제한다.
                        firebaseUpdates[`clubRegistry/${this.clubId}/allowOverLimitSupport`] = false;
                        firebaseUpdates[`clubRegistry/${this.clubId}/allowFacilityFullBudget`] = false;
                        const settleYearKey = String(newHistoryItem.settlementYear || new Date().getFullYear());
                        if (this.yearlyClubRegistry && this.yearlyClubRegistry[settleYearKey] && this.yearlyClubRegistry[settleYearKey][this.clubId]) {
                            firebaseUpdates[`yearlyClubRegistry/${settleYearKey}/${this.clubId}/usedBudget`] = firebase.database.ServerValue.increment(newHistoryItem.finalSupportAmount);
                            firebaseUpdates[`yearlyClubRegistry/${settleYearKey}/${this.clubId}/prizeUsed`] = firebase.database.ServerValue.increment(prizeThisSession);
                            firebaseUpdates[`yearlyClubRegistry/${settleYearKey}/${this.clubId}/allowOverLimitSupport`] = false;
                            firebaseUpdates[`yearlyClubRegistry/${settleYearKey}/${this.clubId}/allowFacilityFullBudget`] = false;
                            this.yearlyClubRegistry[settleYearKey][this.clubId].usedBudget = (this.yearlyClubRegistry[settleYearKey][this.clubId].usedBudget || 0) + newHistoryItem.finalSupportAmount;
                            this.yearlyClubRegistry[settleYearKey][this.clubId].prizeUsed = (this.yearlyClubRegistry[settleYearKey][this.clubId].prizeUsed || 0) + prizeThisSession;
                            this.yearlyClubRegistry[settleYearKey][this.clubId].allowOverLimitSupport = false;
                            this.yearlyClubRegistry[settleYearKey][this.clubId].allowFacilityFullBudget = false;
                        }
                    }
                    this.appendAuditUpdate(firebaseUpdates, {
                        action: 'CREATE',
                        targetType: '정산 이력',
                        targetId: newHistoryItem.id,
                        targetLabel: `${newHistoryItem.clubName} ${newHistoryItem.settlementDate}`,
                        summary: `정산 확정: ${newHistoryItem.clubName} ${newHistoryItem.settlementDate}`,
                        clubId: newHistoryItem.clubId,
                        clubName: newHistoryItem.clubName,
                        details: {
                            정산일: newHistoryItem.settlementDate,
                            총비용: newHistoryItem.totalCost,
                            지원금: newHistoryItem.finalSupportAmount,
                            자부담: newHistoryItem.totalSelfPay,
                            상품비: newHistoryItem.prizeCost || 0,
                            참석인원: newHistoryItem.memberCount,
                            비용항목수: newHistoryItem.expenseItems.length,
                            행사사진수: rawEventPhotoCount,
                            수동자부담수정: this.selfPayManuallyOverridden
                        }
                    });
                    await this.firebaseDb.ref().update(firebaseUpdates);
                    if (registryClub) {
                        try {
                            const clubSnapshot = await this.firebaseDb.ref(`clubRegistry/${this.clubId}`).once('value');
                            persistedClub = clubSnapshot.val();
                        } catch (readErr) {
                            console.warn('정산 후 클럽 누적값 재조회 실패:', readErr);
                        }
                    }
                }

                // 원격 저장 성공 후에만 로컬 이력과 누적값을 반영한다.
                this.settlementHistory = nextSettlementHistory;
                if (this.clubHistory.length > 0) this.clubHistory.unshift(newHistoryItem);

                // 명부 누적 카운트는 전체 공유 정산 이력 기준으로 반영 (오프라인 시 개인 이력 폴백)
                this.directory = nextGlobalDirectory || nextPersonalDirectory;

                // Update used budget (사용자가 수정한 자부담 기준 실제 지원금과 동일한 값 사용)
                this.usedBudget = Math.max(0, this.usedBudget + newHistoryItem.finalSupportAmount);

                if (registryClub) {
                    if (persistedClub) {
                        this.clubRegistry[this.clubId] = { ...registryClub, ...persistedClub, allowOverLimitSupport: false, allowFacilityFullBudget: false };
                    } else {
                        const currentClub = this.clubRegistry[this.clubId] || registryClub;
                        currentClub.usedBudget = (currentClub.usedBudget || 0) + newHistoryItem.finalSupportAmount;
                        currentClub.prizeUsed = (currentClub.prizeUsed || 0) + prizeThisSession;
                        currentClub.allowOverLimitSupport = false;
                        currentClub.allowFacilityFullBudget = false;
                    }
                }

                // Reset current session
                this.expenseItems = [];
                this.attendees = [];
                this.memberCount = 0;
                this.nonMemberCount = 0;
                this.eventNote = '';
                this.previousPrizeTotal = this.clubId && this.clubRegistry[this.clubId]
                    ? (this.clubRegistry[this.clubId].prizeUsed || 0)
                    : 0;
                this.lastCalculatedSelfPay = 0;
                this.selfPayManuallyOverridden = false;
                this.eventPhotos = [];
                this.editingItemId = null;
                this.editingAttendeeId = null;
                const _sdi = document.getElementById('settlement-date-input');
                if (_sdi) _sdi.value = formatLocalDateYMD();
                if (typeof window._onSettleDateReset === 'function') window._onSettleDateReset();

                // Firebase에는 위 원자적 update로 이미 저장했으므로 로컬 백업만 갱신한다.
                this.save(false);
                this.render();
                return true;
            } catch (err) {
                console.error('정산 확정 저장 실패:', err);
                throw err;
            } finally {
                this._finalizeInProgress = false;
            }
        }
    });
};
