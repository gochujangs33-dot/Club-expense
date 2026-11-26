/**
 * Club Expense Settlement App - Main JavaScript Logic
 */
const APP_VERSION      = '1.7.80';
const APP_VERSION_DATE = '2026.11.27';

// 전역 조회 연도 상태 (기본값: 현재 연도, 'ALL'이면 전체 연도)
let _selectedQueryYear = String(new Date().getFullYear());
window._selectedQueryYear = _selectedQueryYear;

// 인당 자부담 비용에 따라 강조 박스의 아이콘/색상을 전환 (100원 이상이면 🔥, 0이면 😊)
function updatePerPersonSelfPayIcon(perPersonSelfPay) {
    const iconEl = document.getElementById('result-per-person-icon');
    const boxEl = document.getElementById('result-per-person-box');
    if (!iconEl || !boxEl) return;
    if (perPersonSelfPay >= 100) {
        iconEl.textContent = '🔥';
        boxEl.classList.remove('no-self-pay');
    } else {
        iconEl.textContent = '😊';
        boxEl.classList.add('no-self-pay');
    }
}

// 1000단위 콤마(,) 표시/파싱 헬퍼
function formatAmount(num) {
    return Number(num || 0).toLocaleString('ko-KR');
}
function parseAmount(val) {
    if (typeof val !== 'string') return Number(val) || 0;
    return parseInt(val.replace(/[^0-9]/g, ''), 10) || 0;
}
// 금액 입력란에 입력하는 즉시 1000단위 콤마(,)를 적용
function setupCurrencyInput(el) {
    if (!el) return;
    // 같은 입력창에 반복 호출돼도 리스너가 쌓이지 않도록 1회만 등록 (추가 배정 팝업은 열 때마다 호출됨)
    if (el._currencyBound) return;
    el._currencyBound = true;
    el.addEventListener('input', () => {
        const cursorFromEnd = el.value.length - el.selectionStart;
        const num = parseAmount(el.value);
        el.value = num === 0 ? (el.value.replace(/[^0-9]/g, '') === '' ? '' : '0') : formatAmount(num);
        const pos = Math.max(0, el.value.length - cursorFromEnd);
        el.setSelectionRange(pos, pos);
    });
}

// --- Firebase Config & Initialization ---
// 구글 Firebase 콘솔에서 발급받은 실제 설정 키값들을 아래에 입력하시면 클라우드 연동이 활성화됩니다.
const firebaseConfig = {
    apiKey: "AIzaSyA_vDZaJvmPiiWTmFxJju6rwLuv7g5g9Jk",
    authDomain: "club-expence.firebaseapp.com",
    databaseURL: "https://club-expence-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "club-expence",
    storageBucket: "club-expence.firebasestorage.app",
    messagingSenderId: "679102443088",
    appId: "1:679102443088:web:ef82b35806569c5b2aab55",
    measurementId: "G-S6W5PN184M"
};

let firebaseDb = null;
let firebaseAuth = null;
try {
    if (firebaseConfig.apiKey && firebaseConfig.apiKey !== "YOUR_API_KEY") {
        firebase.initializeApp(firebaseConfig);
        firebaseDb = firebase.database();
        if (typeof firebase.auth === 'function') {
            firebaseAuth = firebase.auth();
            // 비공개 보안 규칙(auth != null) 환경에서 사이트 접속 시 백그라운드로 안전하게 자동 인증 세션 획득
            firebaseAuth.signInAnonymously().catch(err => {
                console.warn("Firebase anonymous auth:", err.message || err);
            });
        }
        console.log("Firebase initialized successfully.");
    }
} catch (error) {
    console.error("Firebase initialization failed:", error);
}

// --- 1. Expense Category Definitions & Rules (js/calc-locked.js 로 분리됨) ---
// --- 2. 정산 이력 유틸 · 미디어 정책 · extractValidGlobalHistory (js/settlement-history.js 로 분리됨, v1.7.64) ---

// DefaultRules / SettlementValidator / SettlementCalculator 는 js/calc-locked.js 에서 로드됨 (v1.7.48)

// --- 3. App State Management ---
const AppState = {
    // 로그인 상태 관련
    isLoggedIn: false,
    currentPin: null,
    userRole: 'member',       // 'president' | 'developer' | 'admin' | 'member'
    hasAdminAccess: false,    // 관리자 페이지 접속 권한 보유 여부
    isAdminMode: false,       // 현재 관리자 페이지 화면 모드 여부
    _userRoleRef: null,
    firebaseDb: firebaseDb,
    firebaseAuth: firebaseAuth,

    normalizeUserRole(userData, pin) {
        const p = String(pin || '');
        if (userData && typeof userData.role === 'string' && ['president', 'developer', 'admin', 'member'].includes(userData.role)) {
            if (userData.role === 'member' && !userData.roleUpdatedAt) {
                if (p === '002531') return 'developer';
                if (p === '003645') return 'president';
            }
            return userData.role;
        }
        if (userData && userData.isAdmin === true) return 'admin';
        // 초기 기본 권한 (002531=김종필 개발자, 003645=이현준 회장)
        if (p === '002531') return 'developer';
        if (p === '003645') return 'president';
        return 'member';
    },

    checkHasAdminAccess(userData, pin) {
        const role = this.normalizeUserRole(userData, pin);
        return Boolean((userData && userData.isAdmin === true) || role === 'president' || role === 'developer' || role === 'admin');
    },

    getRoleLabel(role, isAdmin = false) {
        if (role === 'president') return '회장';
        if (role === 'developer') return '개발자';
        if (role === 'admin') return '관리자';
        return isAdmin ? '관리자' : '일반 회원';
    },

    // 감사 로그는 공유 데이터 변경의 원인 추적용이며 auditLogs/{pushKey}에 추가 전용으로 기록한다.
    // 사진·영수증 원문이나 비밀값은 저장하지 않고, 화면에서 식별 가능한 요약과 숫자 변경값만 남긴다.
    getAuditActor(actorOverride = null) {
        const pin = String(actorOverride?.pin || this.currentPin || 'offline');
        const name = String(actorOverride?.name || this.userName || '오프라인 사용자');
        const role = actorOverride?.role || (pin === 'offline' ? '오프라인' : this.getRoleLabel(this.userRole, this.hasAdminAccess));
        return { pin, name, role };
    },

    // 로그인/접속 및 정산내용 초기화는 감사 로그 대상에서 제외한다.
    isLoginAuditEvent(event = {}) {
        const action = String(event.action || '').trim().toUpperCase();
        const targetType = String(event.targetType || '').replace(/\s+/g, '').toLowerCase();
        return action === 'LOGIN' || action === 'SIGNIN'
            || ['로그인', '로그인이력', '로그인기록', '접속', '접속이력', '접속기록', 'login', 'signin'].includes(targetType);
    },

    isExcludedAuditEvent(event = {}) {
        if (this.isLoginAuditEvent(event)) return true;
        const targetType = String(event.targetType || '').replace(/\s+/g, '').toLowerCase();
        const summary = String(event.summary || '').replace(/\s+/g, '').toLowerCase();
        if (targetType.includes('정산초기화') || summary.includes('정산내용을초기화') || summary.includes('정산내용초기화') || summary.includes('정산초기화')) {
            return true;
        }
        return false;
    },

    buildAuditEntry(event = {}, actorOverride = null) {
        const actor = this.getAuditActor(actorOverride);
        const cleanText = (value, max = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
        const details = {};
        Object.entries(event.details || {}).slice(0, 30).forEach(([key, value]) => {
            if (value === undefined) return;
            const safeKey = cleanText(key, 80);
            if (!safeKey || /password|secret|token|receipt|photo|image/i.test(safeKey)) return;
            if (value === null || typeof value === 'number' || typeof value === 'boolean') {
                details[safeKey] = value;
            } else {
                details[safeKey] = cleanText(value, 500);
            }
        });
        return {
            timestamp: (typeof firebase !== 'undefined' && firebase.database?.ServerValue?.TIMESTAMP) || Date.now(),
            clientTimestamp: Date.now(),
            actorPin: actor.pin,
            actorName: cleanText(actor.name, 100),
            actorRole: cleanText(actor.role, 30),
            action: cleanText(event.action || 'UPDATE', 20).toUpperCase(),
            targetType: cleanText(event.targetType || '기타', 80),
            targetId: cleanText(event.targetId || '', 160),
            targetLabel: cleanText(event.targetLabel || '', 200),
            summary: cleanText(event.summary || '', 500),
            clubId: cleanText(event.clubId !== undefined ? event.clubId : (this.clubId || ''), 160),
            clubName: cleanText(event.clubName !== undefined ? event.clubName : (this.clubName || ''), 160),
            details
        };
    },

    appendAuditUpdate(updates, event, actorOverride = null) {
        if (!this.firebaseDb || !updates || !event || this.isExcludedAuditEvent(event)) return null;
        const logKey = this.firebaseDb.ref('auditLogs').push().key;
        if (!logKey) return null;
        updates[`auditLogs/${logKey}`] = this.buildAuditEntry(event, actorOverride);
        return logKey;
    },

    writeAuditLog(event, actorOverride = null) {
        if (!this.firebaseDb || !event || this.isExcludedAuditEvent(event)) return Promise.resolve(false);
        const logKey = this.firebaseDb.ref('auditLogs').push().key;
        if (!logKey) return Promise.resolve(false);
        return this.firebaseDb.ref(`auditLogs/${logKey}`).set(this.buildAuditEntry(event, actorOverride))
            .then(() => true)
            .catch(err => {
                console.error('감사 로그 저장 실패:', err);
                return false;
            });
    },

    writeAuditAfterSave(savePromise, event) {
        Promise.resolve(savePromise).then(synced => {
            if (synced) this.writeAuditLog(event);
        }).catch(err => console.error('감사 로그 연결 실패:', err));
        return savePromise;
    },

    memberCount: 0,
    nonMemberCount: 0,
    eventNote: '',
    customNoteOptions: [],
    previousPrizeTotal: 0,
    expenseItems: [],
    attendees: [],
    directory: {},
    editingItemId: null,
    editingAttendeeId: null,
    editingDirName: null,
    dirSearchQuery: '',
    rules: { ...DefaultRules },
    yearlyRules: {},
    tempCorpReceiptImage: null,
    tempPersonalReceiptImage: null,
    lastCalculatedSelfPay: 0,
    // 사용자가 "총 자부담 금액"을 직접 수정해 확정했는지 여부 — true일 때만 lastCalculatedSelfPay를 최종값으로 사용.
    // (itemSelfPay가 정당하게 0원인 경우와 "아직 수정 안 함"을 구분하기 위해 >0 truthy 체크 대신 별도 플래그 사용)
    selfPayManuallyOverridden: false,
    annualBudget: 0,
    usedBudget: 0,
    reportEmail: '',
    emailWebhookUrl: '',
    saveExcelToDevice: true, // 작성 디바이스에 엑셀파일 저장 여부 (기본값 true)
    eventPhotos: [],
    clubName: '',
    clubId: '',
    settlementHistory: [],
    clubHistory: [],
    clubRegistry: {},
    yearlyClubRegistry: {},
    _baseClubRegistry: {},
    clubTotalBudget: 0,
    yearlyClubTotalBudget: {},
    _baseClubTotalBudget: 0,
    editingHistoryId: null,   // 수정 모드 중인 이력 항목 ID
    _editingHistoryOriginal: null, // 현재 수정 중인 공유 이력 원본 (관리자 요약 화면 저장용)
    _finalizeInProgress: false,

    // Load initial state if storage exists (optional local storage helper)
    load() {
        try {
            const savedItems = localStorage.getItem('club_expense_items');
            if (savedItems) {
                const parsed = JSON.parse(savedItems);
                if (Array.isArray(parsed)) this.expenseItems = parsed;
            }
            const savedMemberCount = localStorage.getItem('club_expense_members');
            if (savedMemberCount) {
                this.memberCount = parseInt(savedMemberCount, 10) || 0;
            }
            const savedNonMemberCount = localStorage.getItem('club_expense_non_members');
            if (savedNonMemberCount !== null) {
                this.nonMemberCount = Math.max(0, parseInt(savedNonMemberCount, 10) || 0);
            }
            const savedEventNote = localStorage.getItem('club_expense_event_note');
            if (savedEventNote !== null) {
                this.eventNote = savedEventNote;
            }
            const savedCustomNotes = localStorage.getItem('club_custom_note_options');
            if (savedCustomNotes) {
                try {
                    const parsedNotes = JSON.parse(savedCustomNotes);
                    if (Array.isArray(parsedNotes)) this.customNoteOptions = parsedNotes;
                } catch (_) {}
            }
            // previousPrizeTotal은 clubRegistry.prizeUsed 기준 — localStorage 구버전 값 무시
            // rules는 globalSettings/rules (관리자 설정) 기준 — localStorage 구버전 무시
            const savedAttendees = localStorage.getItem('club_expense_attendees');
            if (savedAttendees) {
                const parsed = JSON.parse(savedAttendees);
                if (Array.isArray(parsed)) {
                    this.attendees = parsed;
                    this.memberCount = this.attendees.length;
                }
            }
            const savedDirectory = localStorage.getItem('club_expense_directory');
            if (savedDirectory) {
                const parsed = JSON.parse(savedDirectory);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) this.directory = parsed;
            }
            // annualBudget → clubRegistry.budget, usedBudget → 동적 계산 — localStorage 구버전 무시
            const savedReportEmail = localStorage.getItem('club_report_email');
            if (savedReportEmail) this.reportEmail = savedReportEmail;
            const savedSaveExcel = localStorage.getItem('club_save_excel_device');
            if (savedSaveExcel !== null) this.saveExcelToDevice = savedSaveExcel !== 'false';
            const savedEventPhotos = localStorage.getItem('club_event_photos');
            if (savedEventPhotos) {
                try { this.eventPhotos = JSON.parse(savedEventPhotos); } catch(_) {}
            } else {
                const legacy = localStorage.getItem('club_event_photo');
                if (legacy) this.eventPhotos = [legacy];
            }
            const savedClubName = localStorage.getItem('club_name');
            if (savedClubName) this.clubName = savedClubName;
            const savedClubId = localStorage.getItem('club_id');
            if (savedClubId) this.clubId = savedClubId;
            const savedHistory = localStorage.getItem('club_settlement_history');
            if (savedHistory) {
                const parsed = JSON.parse(savedHistory);
                if (Array.isArray(parsed)) this.settlementHistory = parsed;
            }
            const savedCountYear = localStorage.getItem('club_directory_count_year');
            this.directoryCountYear = savedCountYear ? parseInt(savedCountYear, 10) : new Date().getFullYear();
        } catch (e) {
            console.error("Local storage load failed:", e);
        }

        this.resetDirectoryCountsIfNewYear();
    },

    // 누적 사원 명부의 "올해 누적 참석 횟수"는 연 단위 카운트 - 새해가 되면 0으로 초기화
    resetDirectoryCountsIfNewYear() {
        const currentYear = new Date().getFullYear();
        if (this.directoryCountYear !== currentYear) {
            const prevYear = this.directoryCountYear;
            Object.keys(this.directory).forEach(name => {
                let entry = this.directory[name];
                if (typeof entry !== 'object') {
                    entry = { id: entry, count: 0 };
                    this.directory[name] = entry;
                }
                if (entry.count > 0) {
                    if (!entry.history) entry.history = {};
                    entry.history[prevYear] = entry.count;
                }
                entry.count = 0;
            });
            this.directoryCountYear = currentYear;
            localStorage.setItem('club_directory_count_year', currentYear.toString());
            this.save();
        }
    },

    // 전사원 명부 일괄 등록: 기존에 등록된 이름은 건드리지 않고, 새 이름만 추가
    // 동명이인은 ids 배열에 누적 보관 (사번 선택 드롭다운용)
    bulkImportDirectory(list) {
        let added = 0;
        let updated = 0;
        // JSON에 있는 이름 집합 (이름 변경 감지용)
        const jsonNameSet = new Set(list.map(([n]) => n));

        // 역방향 맵: 사번 → 현재 등록된 이름
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
                // JSON에서 이름이 바뀐 경우 (예: "이진호(PS)" → "이진호")
                // 구 항목에서 이 사번 제거
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
                // 새 이름에 추가
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
                    if (idToName[eid]) return; // 이미 다른 이름으로 등록된 사번 — 건너뜀
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
        // (예: "이진호(PS)"가 로컬/Firebase에 남아있어도 로그인 시 자동 제거)
        const jsonIdSet = new Set(list.map(([, id]) => String(id)));
        let cleaned = 0;
        Object.keys(this.directory).forEach(n => {
            if (jsonNameSet.has(n)) return;
            const e = this.directory[n];
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
        this.updateDatalist();
        return added;
    },

    // 검색어에 맞는 사원 목록 반환 (동명이인 포함 — 사번 선택 드롭다운용)
    getAllDirectoryMatches(query) {
        if (!query) return [];
        const q = query.trim();
        const results = [];
        Object.entries(this.directory).forEach(([name, val]) => {
            if (!name.includes(q)) return;
            const ids = (typeof val === 'object' && Array.isArray(val.ids) && val.ids.length > 0)
                ? val.ids
                : [typeof val === 'object' ? String(val.id) : String(val)];
            ids.forEach(id => results.push({ name, id }));
        });
        return results;
    },

    // 동명이인 사번 선택 시 참고용 — 현재 선택된 클럽(clubHistory)에서 해당 사번의
    // 가장 최근 참석 이력 날짜를 반환 (없으면 null)
    getRecentClubAttendance(employeeId) {
        const id = String(employeeId);
        let latest = null;
        (this.clubHistory || []).forEach(entry => {
            const matched = (entry.attendees || []).some(a => a.employeeId != null && String(a.employeeId) === id);
            if (!matched) return;
            const time = entry.settlementDate
                ? new Date(entry.settlementDate + 'T00:00:00').getTime()
                : (entry.date ? new Date(entry.date).getTime() : (entry.id || 0));
            if (!latest || time > latest.time) {
                latest = { time, dateStr: entry.settlementDate || (entry.date ? formatLocalDateYMD(entry.date) : '') };
            }
        });
        return latest;
    },

    // 관리자 전용: globalHistory 전체 기준으로 명부 카운트 재계산 (모든 사용자 정산 반영)
    // ── 사번 기준 카운트 공통 헬퍼 ───────────────────────────────────────
    // 무조건 사번(employeeId) 기준 귀속 — 사번 없는 참석자는 스킵 (v1.6.198)
    // ⚠️ 이름 기반 폴백 재도입 금지: 동명이인 카운트 오귀속 버그 재발함 (CLAUDE.md §1-6 참조)
    _countAttendeesByEmpId(attendeeList, idToName) {
        attendeeList.forEach(att => {
            if (!att.name) return;
            const empId = att.employeeId ? String(att.employeeId) : '';
            // 사번 없으면 완전 스킵 — 이름 기반 폴백 없음 (무조건 사번 기준)
            if (!empId) return;
            const dirKey = idToName[empId];
            if (!dirKey) return; // 명부에 없는 사번
            const cur = this.directory[dirKey];
            if (!cur || typeof cur !== 'object') return;
            if (!cur.counts) cur.counts = {};
            cur.counts[empId] = (cur.counts[empId] || 0) + 1;
            // aggregate count 동기화 (정렬 기준)
            cur.count = Object.values(cur.counts).reduce((s, v) => s + v, 0);
        });
    },

    // ── 카운트 초기화 공통 헬퍼 ─────────────────────────────────────────
    _resetDirectoryCounts() {
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
    },

    // ── 사번 → 명부 키 역방향 맵 생성 ────────────────────────────────────
    _buildIdToName() {
        const idToName = {};
        Object.entries(this.directory).forEach(([name, entry]) => {
            if (typeof entry !== 'object') return;
            const ids = entry.ids ? entry.ids.map(String) : (entry.id ? [String(entry.id)] : []);
            ids.forEach(id => { if (id) idToName[id] = name; });
        });
        return idToName;
    },

    async recalculateDirectoryCountsFromGlobal() {
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
        // 카운트 갱신 후 UI 즉시 반영 (로그인 완료 전 호출되는 경우 스킵)
        if (this.isLoggedIn && typeof this.render === 'function') this.render();
    },

    // — 일반 사용자 전용 (자신의 정산 이력만 접근 가능)
    recalculateDirectoryCounts() {
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
    },

    // 아직 로컬 상태에 넣지 않은 신규 이력까지 포함해 저장용 명부 카운트를 계산한다.
    // 기존 명부 객체는 건드리지 않으며, 사번 없는 참석자는 반드시 스킵한다(v1.6.198 불변량).
    buildDirectoryCountsForHistory(historyList, sourceDirectory = this.directory) {
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
    },

    buildPersonalHistoryForSync(historyList = this.settlementHistory) {
        const entries = Array.isArray(historyList) ? historyList : Object.values(historyList || {});
        // v1.6.242부터 확정된 새 이력은 globalHistory에만 첨부 원본을 보관한다.
        // 이전 이력은 global 원본 존재 여부가 보장되지 않으므로 보존 기한까지 그대로 둔다.
        return entries.map(entry => entry && entry.mediaStoredInGlobal ? stripHistoryMedia(entry) : entry);
    },

    // 현재 정산 1건에 포함될 첨부의 Base64 문자열 크기(대략적인 Firebase write 크기)를 계산한다.
    getDraftMediaBytes(overrides = {}) {
        const hasOverride = key => Object.prototype.hasOwnProperty.call(overrides, key);
        const eventPhotos = hasOverride('eventPhotos') ? overrides.eventPhotos : this.eventPhotos;
        const eventPhotoList = Array.isArray(eventPhotos) ? eventPhotos : (eventPhotos ? [eventPhotos] : []);
        const tempCorp = hasOverride('tempCorpReceiptImage') ? overrides.tempCorpReceiptImage : this.tempCorpReceiptImage;
        const tempPersonal = hasOverride('tempPersonalReceiptImage') ? overrides.tempPersonalReceiptImage : this.tempPersonalReceiptImage;
        // 수정 중인 항목은 임시 영수증으로 대체되므로 기존 첨부를 중복 합산하지 않는다.
        const settledItems = (this.expenseItems || []).filter(item => item.id !== this.editingItemId);
        const mediaValues = [
            ...eventPhotoList,
            tempCorp,
            tempPersonal
        ];
        settledItems.forEach(item => {
            mediaValues.push(item.receiptImage, item.corporateReceiptImage, item.personalReceiptImage);
        });
        return [...new Set(mediaValues.filter(Boolean))].reduce((sum, value) => sum + getMediaDataSize(value), 0);
    },

    getHistoryMediaBytes(entry) {
        if (!entry || typeof entry !== 'object') return 0;
        const mediaValues = [
            ...getHistoryEventPhotos(entry),
            ...getHistoryExpenseItems(entry).flatMap(item => [
                item && item.receiptImage,
                item && item.corporateReceiptImage,
                item && item.personalReceiptImage
            ])
        ];
        return [...new Set(mediaValues.filter(Boolean))].reduce((sum, value) => sum + getMediaDataSize(value), 0);
    },

    isDraftMediaWithinLimit(overrides = {}) {
        return this.getDraftMediaBytes(overrides) <= MediaStoragePolicy.maxSettlementBytes;
    },

    save(syncFirebase = true) {
        // 1. 로컬 백업 저장 (오프라인 상태 대비)
        try {
            localStorage.setItem('club_expense_items', JSON.stringify(this.expenseItems));
            localStorage.setItem('club_expense_members', this.memberCount.toString());
            localStorage.setItem('club_expense_non_members', String(this.nonMemberCount || 0));
            localStorage.setItem('club_expense_event_note', this.eventNote || '');
            localStorage.setItem('club_custom_note_options', JSON.stringify(this.customNoteOptions || []));
            localStorage.setItem('club_expense_attendees', JSON.stringify(this.attendees));
            localStorage.setItem('club_expense_directory', JSON.stringify(this.directory));
            localStorage.setItem('club_report_email', this.reportEmail || '');
            localStorage.setItem('club_save_excel_device', this.saveExcelToDevice ? 'true' : 'false');
            // club_expense_rules → globalSettings/rules (관리자 전용, localStorage 저장 중단)
            // club_annual_budget → clubRegistry.budget (관리자 전용, localStorage 저장 중단)
            // club_used_budget → 동적 계산 (localStorage 저장 중단)
            // club_expense_prev_prize → clubRegistry.prizeUsed (관리자 전용, localStorage 저장 중단)
            localStorage.setItem('club_name', this.clubName);
            localStorage.setItem('club_id', this.clubId || '');
            // 확정 이력의 첨부 원본은 globalHistory 단일 기준으로 보관해 브라우저·개인 Firebase 용량을 줄인다.
            // 오프라인에서도 기존 첨부를 잃지 않도록 브라우저 백업은 원본 그대로 유지한다.
            try { localStorage.setItem('club_settlement_history', JSON.stringify(this.settlementHistory)); } catch(_) {}
            if (this.eventPhotos && this.eventPhotos.length > 0) {
                try { localStorage.setItem('club_event_photos', JSON.stringify(this.eventPhotos)); } catch(_) {}
            } else {
                localStorage.removeItem('club_event_photos');
            }
        } catch (e) {
            console.error("Local storage save failed:", e);
        }

        // 2. Firebase 온라인 실시간 클라우드 동기화
        if (syncFirebase && this.isLoggedIn && this.firebaseDb && this.currentPin) {
            const dataToSync = {
                // 세션 데이터만 유저별 저장 (영수증·행사 사진은 메일로 백업하므로 Firebase DB에는 저장하지 않음)
                memberCount: this.memberCount,
                nonMemberCount: this.nonMemberCount || 0,
                eventNote: this.eventNote || '',
                expenseItems: stripHistoryMedia({ expenseItems: this.expenseItems }).expenseItems,
                attendees: this.attendees,
                directory: this.directory,
                clubName: this.clubName,   // 마지막 선택 클럽명 (편의용)
                clubId: this.clubId || '', // 마지막 선택 클럽 ID (편의용)
                reportEmail: this.reportEmail || '',
                saveExcelToDevice: this.saveExcelToDevice !== false,
                settlementHistory: this.buildPersonalHistoryForSync(),
                eventPhotos: null,
                lastUpdated: Date.now()
                // rules → globalSettings/rules (관리자 전용)
                // annualBudget → clubRegistry.budget (관리자 전용)
                // usedBudget → 동적 계산, 저장 불필요
                // previousPrizeTotal → clubRegistry.prizeUsed (관리자 전용)
            };
            return this.firebaseDb.ref(`settlements/${this.currentPin}`).set(dataToSync)
                .then(() => true)
                .catch(err => {
                    console.error("Firebase sync failed:", err);
                    return false;
                });
            // save() 시 globalHistory backfill 제거 — 관리자가 삭제한 항목을 되살리는 원인이 됨
            // 신규 정산 확정 시 finalizeSettlement()에서 직접 globalHistory에 쓰므로 여기선 불필요
        }
        return Promise.resolve(false);
    },

    // 보관 기한(정산 다음 해 1분기) 종료된 행사 사진·영수증만 제거한다.
    // 금액, 참석자, 항목명 등 정산 데이터는 절대 변경하지 않는다.
    async cleanupExpiredHistoryMedia() {
        if (!this.firebaseDb || !this.isLoggedIn || !this.currentPin) {
            return { cleanedGlobal: 0, cleanedPersonal: 0 };
        }

        const updates = {};
        let cleanedGlobal = 0;
        let cleanedPersonal = 0;
        const addMediaRemoval = (basePath, entry, isGlobal) => {
            if (!isHistoryMediaExpired(entry) || !hasHistoryMedia(entry)) return false;
            const cleaned = stripHistoryMedia(entry);
            updates[`${basePath}/eventPhotos`] = null;
            updates[`${basePath}/eventPhoto`] = null;
            if (getHistoryExpenseItems(entry).some(hasReceiptMedia)) {
                updates[`${basePath}/expenseItems`] = cleaned.expenseItems;
            }
            if (isGlobal) cleanedGlobal++;
            else cleanedPersonal++;
            return true;
        };

        try {
            const personalPins = new Set([String(this.currentPin)]);
            if (this.hasAdminAccess) {
                const [historySnapshot, deletedSnapshot] = await Promise.all([
                    this.firebaseDb.ref('globalHistory').once('value'),
                    this.firebaseDb.ref('deletedHistoryIds').once('value')
                ]);
                const deletedIds = new Set(Object.keys(deletedSnapshot.val() || {}));
                historySnapshot.forEach(child => {
                    if (deletedIds.has(String(child.key))) return;
                    const entry = child.val();
                    if (!entry || !isHistoryMediaExpired(entry)) return;
                    if (entry.creatorPin) personalPins.add(String(entry.creatorPin));
                    addMediaRemoval(`globalHistory/${child.key}`, entry, true);
                });
            }

            const personalSnapshots = await Promise.all([...personalPins].map(async pin => {
                try {
                    return [pin, await this.firebaseDb.ref(`settlements/${pin}/settlementHistory`).once('value')];
                } catch (err) {
                    console.warn(`만료 첨부 개인 이력 조회 실패 (${pin}):`, err);
                    return [pin, null];
                }
            }));
            personalSnapshots.forEach(([pin, snapshot]) => {
                if (!snapshot) return;
                snapshot.forEach(child => {
                    const entry = child.val();
                    addMediaRemoval(`settlements/${pin}/settlementHistory/${child.key}`, entry, false);
                });
            });

            if (Object.keys(updates).length > 0) {
                this.appendAuditUpdate(updates, {
                    action: 'DELETE',
                    targetType: '만료 첨부',
                    targetLabel: '보존기간 만료 사진·영수증',
                    summary: `보존기간이 지난 첨부 자동 정리: 공유 ${cleanedGlobal}건, 개인 ${cleanedPersonal}건`,
                    details: { 공유이력정리수: cleanedGlobal, 개인이력정리수: cleanedPersonal }
                }, { pin: 'system', name: '시스템 자동 정리', role: '시스템' });
                await this.firebaseDb.ref().update(updates);
            }
            return { cleanedGlobal, cleanedPersonal };
        } catch (err) {
            console.error('만료 첨부 자동 정리 실패:', err);
            return { cleanedGlobal: 0, cleanedPersonal: 0, error: err };
        }
    },

    // Firebase 인증·권한 리스너·공유 명부 로더는 js/auth-firebase.js 로 분리됨 (v1.7.69)

    // ── 클럽 레지스트리 (연도별 분리 관리: yearlyClubRegistry/{연도} + 올해 기준 clubRegistry 병행 동기화) ──────────────
    getActiveQueryYear() {
        const realY = new Date().getFullYear();
        const raw = (typeof window !== 'undefined' && window._selectedQueryYear)
            ? window._selectedQueryYear
            : (typeof _selectedQueryYear !== 'undefined' ? _selectedQueryYear : '');
        if (raw && raw !== 'ALL') {
            return parseInt(raw, 10) || realY;
        }
        return realY;
    },

    getClubRegistryForYear(year = null) {
        const realY = new Date().getFullYear();
        const targetY = Number(year) || this.getActiveQueryYear();
        const yKey = String(targetY);
        if (this.yearlyClubRegistry && this.yearlyClubRegistry[yKey] && typeof this.yearlyClubRegistry[yKey] === 'object') {
            return JSON.parse(JSON.stringify(this.yearlyClubRegistry[yKey]));
        }
        let base = (this.yearlyClubRegistry && this.yearlyClubRegistry[String(realY)]) || this._baseClubRegistry || {};
        if (Object.keys(base).length === 0 && this.yearlyClubRegistry) {
            const latestPrevYear = Object.keys(this.yearlyClubRegistry)
                .map(k => Number(k))
                .filter(y => !Number.isNaN(y) && y < targetY)
                .sort((a, b) => b - a)[0];
            if (latestPrevYear !== undefined) {
                base = this.yearlyClubRegistry[String(latestPrevYear)] || {};
            }
        }
        if (targetY === realY) {
            return JSON.parse(JSON.stringify(base));
        }
        const cloned = {};
        Object.entries(base).forEach(([cid, c]) => {
            if (!c) return;
            cloned[cid] = {
                ...c,
                priorUsed: 0,
                usedBudget: 0,
                prizeUsed: 0,
                allowOverLimitSupport: false,
                allowFacilityFullBudget: false
            };
        });
        return cloned;
    },

    getClubTotalBudgetForYear(year = null) {
        const realY = new Date().getFullYear();
        const targetY = Number(year) || this.getActiveQueryYear();
        const yKey = String(targetY);
        if (this.yearlyClubTotalBudget && this.yearlyClubTotalBudget[yKey] !== undefined) {
            return Number(this.yearlyClubTotalBudget[yKey]) || 0;
        }
        if (this.yearlyClubTotalBudget && this.yearlyClubTotalBudget[String(realY)] !== undefined) {
            return Number(this.yearlyClubTotalBudget[String(realY)]) || 0;
        }
        return Number(this._baseClubTotalBudget) || 0;
    },

    syncActiveClubStateForQueryYear(isInitial = false) {
        const targetY = this.getActiveQueryYear();
        this.clubRegistry = this.getClubRegistryForYear(targetY);
        this.clubTotalBudget = this.getClubTotalBudgetForYear(targetY);
        if (this.clubId && this.clubRegistry[this.clubId]) {
            const regEntry = this.clubRegistry[this.clubId];
            this.previousPrizeTotal = regEntry.prizeUsed || 0;
            let changed = false;
            if (regEntry.name && regEntry.name !== this.clubName) {
                const prevName = this.clubName;
                this.clubName = regEntry.name;
                if (this.settlementHistory) {
                    this.settlementHistory.forEach(entry => {
                        if (entry && ((entry.clubId && entry.clubId === this.clubId) || (!entry.clubId && entry.clubName === prevName))) {
                            entry.clubName = regEntry.name;
                        }
                    });
                }
                changed = true;
            }
            if (regEntry.budget !== undefined && regEntry.budget !== this.annualBudget) {
                this.annualBudget = regEntry.budget;
                changed = true;
            }
            if (changed) this.save();
        } else if (this.clubId && !isInitial && targetY === new Date().getFullYear()) {
            this.clubName = '';
            this.clubId = '';
            this.save();
            if (typeof window.showClubNotFoundModal === 'function') window.showClubNotFoundModal();
        }
        if (typeof window._onClubRegistryUpdate === 'function') window._onClubRegistryUpdate();
        if (typeof window._onClubTotalBudgetUpdate === 'function') window._onClubTotalBudgetUpdate();
    },

    _buildYearlyClubUpdates(updates, clubId, valueOrNull, field = null, year = null) {
        const realY = new Date().getFullYear();
        const targetY = Number(year) || this.getActiveQueryYear();
        const yKey = String(targetY);
        const hasYearlyNode = Boolean(this.yearlyClubRegistry && this.yearlyClubRegistry[yKey]);

        // 로컬 yearlyClubRegistry 캐시도 즉시 동기화
        if (!this.yearlyClubRegistry) this.yearlyClubRegistry = {};
        this.yearlyClubRegistry[yKey] = JSON.parse(JSON.stringify(this.clubRegistry || {}));

        if (!hasYearlyNode) {
            // 해당 연도(예: 2027년) 첫 변경 시, 변경이 반영된 전체 스냅샷을 yearlyClubRegistry/{연도}에 독립 저장
            updates[`yearlyClubRegistry/${yKey}`] = this.yearlyClubRegistry[yKey];
        } else if (field) {
            updates[`yearlyClubRegistry/${yKey}/${clubId}/${field}`] = valueOrNull;
        } else {
            updates[`yearlyClubRegistry/${yKey}/${clubId}`] = valueOrNull;
        }

        // 실제 올해(예: 2026년) 변경일 때만 기존 공용 clubRegistry 경로도 함께 동기화 (타 연도 변경 시 올해 데이터 100% 보존)
        if (targetY === realY) {
            if (field) {
                updates[`clubRegistry/${clubId}/${field}`] = valueOrNull;
            } else {
                updates[`clubRegistry/${clubId}`] = valueOrNull;
            }
        }
    },

    // loadClubRegistry / saveClubRegistry / loadGlobalSettings / saveEmailWebhookUrl / saveCustomNoteOptions 는 js/auth-firebase.js 로 분리됨 (v1.7.69)

    // 연도별 정산 구간·비율 설정(getRulesForYear / saveGlobalRules / updateRules / resetRules)은 js/rules-manager.js 로 분리됨 (v1.7.70)

    saveClubTotalBudget(value) {
        const previousValue = this.clubTotalBudget || 0;
        const targetY = this.getActiveQueryYear();
        this.clubTotalBudget = Math.max(0, value || 0);
        if (!this.yearlyClubTotalBudget) this.yearlyClubTotalBudget = {};
        this.yearlyClubTotalBudget[String(targetY)] = this.clubTotalBudget;
        if (previousValue === this.clubTotalBudget) return Promise.resolve(true);
        if (this.firebaseDb) {
            const updates = { [`yearlyClubTotalBudget/${targetY}`]: this.clubTotalBudget };
            if (targetY === new Date().getFullYear()) {
                updates['clubTotalBudget'] = this.clubTotalBudget;
            }
            this.appendAuditUpdate(updates, {
                action: 'UPDATE',
                targetType: '금액 수정 (총 예산)',
                targetLabel: `${targetY}년 총 클럽비용`,
                summary: `${targetY}년 총 클럽 예산 금액 수정: ${SettlementCalculator.formatCurrency(previousValue)} → ${SettlementCalculator.formatCurrency(this.clubTotalBudget)}`,
                details: { 적용연도: `${targetY}년`, 이전금액: previousValue, 변경금액: this.clubTotalBudget }
            });
            return this.firebaseDb.ref().update(updates)
                .then(() => true)
                .catch(err => {
                    console.error("총 클럽비용 저장 실패:", err);
                    throw err;
                });
        }
        return Promise.resolve();
    },

    addOrUpdateClub(clubId, name, budget, priorUsed, prizeUsed) {
        const hadExisting = !!this.clubRegistry[clubId];
        const existing = this.clubRegistry[clubId] || {};
        const previous = { ...existing };
        this.clubRegistry[clubId] = {
            name: name.trim(),
            budget: Math.max(0, budget || 0),
            priorUsed: Math.max(0, priorUsed || 0),
            prizeUsed: prizeUsed !== undefined ? Math.max(0, prizeUsed) : (existing.prizeUsed || 0),
            usedBudget: existing.usedBudget || 0,
            // 관리자 차트의 클럽 고유 색상 — 이름·예산 수정 시에도 유지
            chartColor: existing.chartColor || '',
            // 인당 85,000원 초과 지원 승인 여부(관리자 전용 토글) — 이름/예산 수정 시 유실되지 않도록 보존
            allowOverLimitSupport: existing.allowOverLimitSupport || false,
            // 시설·장비 1회 배정(잔여) 예산 전액 사용 승인 여부 — 이름/예산 수정 시 유실되지 않도록 보존
            allowFacilityFullBudget: existing.allowFacilityFullBudget || false,
            // 클럽별 정회원 명단 — 이름/예산 수정 시 유실되지 않도록 보존
            regularMembers: Array.isArray(existing.regularMembers) ? existing.regularMembers : []
        };
        if (this.firebaseDb) {
            const targetY = this.getActiveQueryYear();
            const updates = {};
            this._buildYearlyClubUpdates(updates, clubId, this.clubRegistry[clubId], null, targetY);
            const changes = [];
            const nameChanged = hadExisting && previous.name !== this.clubRegistry[clubId].name;
            const budgetChanged = hadExisting && (previous.budget || 0) !== this.clubRegistry[clubId].budget;
            if (nameChanged) changes.push(`이름 '${previous.name || '-'}' → '${this.clubRegistry[clubId].name}'`);
            if (budgetChanged) changes.push(`배정예산 ${SettlementCalculator.formatCurrency(previous.budget || 0)} → ${SettlementCalculator.formatCurrency(this.clubRegistry[clubId].budget)}`);

            let targetType = '클럽 등록';
            if (hadExisting) {
                if (nameChanged && budgetChanged) targetType = '클럽명 및 금액 수정';
                else if (nameChanged) targetType = '클럽명 변경';
                else if (budgetChanged) targetType = '금액 수정 (클럽 예산)';
                else targetType = '클럽 정보 수정';
            }

            this.appendAuditUpdate(updates, {
                action: hadExisting ? 'UPDATE' : 'CREATE',
                targetType,
                targetId: clubId,
                targetLabel: this.clubRegistry[clubId].name,
                summary: hadExisting
                    ? `클럽 '${this.clubRegistry[clubId].name}' ${targetType}${changes.length ? ` (${changes.join(', ')})` : ''}`
                    : `신규 클럽 '${this.clubRegistry[clubId].name}' 등록 (배정 예산: ${SettlementCalculator.formatCurrency(this.clubRegistry[clubId].budget)})`,
                clubId,
                clubName: this.clubRegistry[clubId].name,
                details: {
                    이전이름: previous.name || '-',
                    변경이름: this.clubRegistry[clubId].name,
                    이전예산: previous.budget || 0,
                    변경예산: this.clubRegistry[clubId].budget,
                    이전기존사용액: previous.priorUsed || 0,
                    변경기존사용액: this.clubRegistry[clubId].priorUsed
                }
            });
            this.firebaseDb.ref().update(updates).catch(err => console.error("클럽 저장 실패:", err));
        }
    },

    // 관리자 전용 추가 배정 — 일반 예산 수정과 구분하고 잔여금 산정 근거까지 한 로그에 남긴다.
    addClubBudgetAllocation(clubId, addAmount) {
        const club = this.clubRegistry[clubId];
        const allocation = Math.max(0, Number(addAmount) || 0);
        if (!club || allocation <= 0) return Promise.resolve(false);

        const previousBudget = Math.max(0, Number(club.budget) || 0);
        const priorUsed = Math.max(0, Number(club.priorUsed) || 0);
        const usedBudget = Math.max(0, Number(club.usedBudget) || 0);
        const totalBudget = previousBudget + allocation;
        const remainingBudget = totalBudget - priorUsed - usedBudget;
        const clubName = club.name || '이름 없는 클럽';

        this.clubRegistry[clubId] = { ...club, budget: totalBudget };
        if (!this.firebaseDb) return Promise.resolve(true);

        const targetY = this.getActiveQueryYear();
        const updates = {};
        this._buildYearlyClubUpdates(updates, clubId, this.clubRegistry[clubId], null, targetY);
        this.appendAuditUpdate(updates, {
            action: 'UPDATE',
            targetType: '추가 배정',
            targetId: clubId,
            targetLabel: clubName,
            summary: `클럽 '${clubName}' 추가 배정: +${SettlementCalculator.formatCurrency(allocation)} (총 ${SettlementCalculator.formatCurrency(totalBudget)}, 잔여 ${SettlementCalculator.formatCurrency(remainingBudget)})`,
            clubId,
            clubName,
            details: {
                '기존 배정 금액': previousBudget,
                '추가 배정 금액': allocation,
                '총 배정 금액': totalBudget,
                '확정 지원금 누적': usedBudget,
                '추가 배정 후 잔여금': remainingBudget
            }
        });
        return this.firebaseDb.ref().update(updates)
            .then(() => true)
            .catch(err => {
                this.clubRegistry[clubId] = club;
                console.error('클럽 추가 배정 저장 실패:', err);
                return false;
            });
    },

    // 관리자 전용: 이 클럽의 인당 85,000원 초과 지원 승인 여부 토글 (다른 필드는 건드리지 않음)
    setClubOverLimitApproval(clubId, allowed) {
        if (!this.clubRegistry[clubId]) return;
        const clubName = this.clubRegistry[clubId].name || '';
        this.clubRegistry[clubId].allowOverLimitSupport = !!allowed;
        if (this.firebaseDb) {
            const updates = {};
            this._buildYearlyClubUpdates(updates, clubId, !!allowed, 'allowOverLimitSupport');
            this.appendAuditUpdate(updates, {
                action: 'UPDATE',
                targetType: '85k 승인',
                targetId: clubId,
                targetLabel: clubName,
                summary: `클럽 '${clubName}' 인당 85,000원 초과 지원 1회 ${allowed ? '승인' : '승인 취소'}`,
                clubId,
                clubName,
                details: {
                    승인여부: allowed ? '85k 승인' : '85k 미승인',
                    설명: allowed ? '다음 정산 1건에 한해 인당 85,000원 초과 지원 허용' : '초과 지원 승인 취소'
                }
            });
            this.firebaseDb.ref().update(updates).catch(err => console.error("승인 설정 저장 실패:", err));
        }
    },

    // 관리자 전용: 이 클럽의 시설·장비 이용료 1회 배정(잔여) 예산 전액 사용 승인 여부 토글
    setClubFacilityFullBudgetApproval(clubId, allowed) {
        if (!this.clubRegistry[clubId]) return;
        const clubName = this.clubRegistry[clubId].name || '';
        this.clubRegistry[clubId].allowFacilityFullBudget = !!allowed;
        if (this.firebaseDb) {
            const updates = {};
            this._buildYearlyClubUpdates(updates, clubId, !!allowed, 'allowFacilityFullBudget');
            this.appendAuditUpdate(updates, {
                action: 'UPDATE',
                targetType: '시설비 전액 승인',
                targetId: clubId,
                targetLabel: clubName,
                summary: `클럽 '${clubName}' 시설·장비 배정예산 전액 1회 ${allowed ? '승인' : '승인 취소'}`,
                clubId,
                clubName,
                details: {
                    승인여부: allowed ? '시설 장비 승인' : '시설 장비 미승인',
                    설명: allowed ? '다음 정산 1건에 한해 시설·장비 이용료를 잔여 예산 전액까지 법인카드 사용 허용 (초과분 개인카드)' : '시설비 전액 승인 취소'
                }
            });
            this.firebaseDb.ref().update(updates).catch(err => console.error("시설비 전액 승인 저장 실패:", err));
        }
    },

    // 관리자 전용: 모든 차트에서 공통으로 사용할 클럽 고유 색상 저장
    setClubChartColor(clubId, color) {
        const club = this.clubRegistry[clubId];
        const normalized = /^#[0-9a-f]{6}$/i.test(String(color || '')) ? String(color).toLowerCase() : '';
        if (!club || !normalized || club.chartColor === normalized) return Promise.resolve(false);
        const previousColor = club.chartColor || '';
        club.chartColor = normalized;
        if (!this.firebaseDb) return Promise.resolve(true);
        const updates = {};
        this._buildYearlyClubUpdates(updates, clubId, normalized, 'chartColor');
        this.appendAuditUpdate(updates, {
            action: 'UPDATE',
            targetType: '클럽 차트 색상',
            targetId: clubId,
            targetLabel: club.name || '',
            summary: `클럽 '${club.name || clubId}'의 차트 색상을 ${normalized}로 수정`,
            clubId,
            clubName: club.name || '',
            details: { 이전색상: previousColor || '자동', 변경색상: normalized }
        });
        return this.firebaseDb.ref().update(updates)
            .then(() => true)
            .catch(err => {
                club.chartColor = previousColor;
                console.error('클럽 차트 색상 저장 실패:', err);
                throw err;
            });
    },

    deleteClub(clubId) {
        const deletedClub = this.clubRegistry[clubId] ? { ...this.clubRegistry[clubId] } : null;
        const targetY = this.getActiveQueryYear();
        delete this.clubRegistry[clubId];
        if (this.firebaseDb) {
            const updates = {};
            this._buildYearlyClubUpdates(updates, clubId, null, null, targetY);
            this.appendAuditUpdate(updates, {
                action: 'DELETE',
                targetType: '클럽',
                targetId: clubId,
                targetLabel: deletedClub?.name || '',
                summary: `${targetY}년 클럽 '${deletedClub?.name || clubId}' 삭제`,
                clubId,
                clubName: deletedClub?.name || '',
                details: {
                    적용연도: `${targetY}년`,
                    배정예산: deletedClub?.budget || 0,
                    기존사용액: deletedClub?.priorUsed || 0,
                    사용지원금: deletedClub?.usedBudget || 0,
                    상품비사용액: deletedClub?.prizeUsed || 0
                }
            });
            this.firebaseDb.ref().update(updates).catch(err => console.error("클럽 삭제 실패:", err));
        }
    },

    _autoDeduplicateClubs() {
        const registry = this.clubRegistry;
        const groups = {};
        for (const [id, club] of Object.entries(registry)) {
            const key = (club.name || '').trim().toLowerCase();
            if (!key) continue;
            if (!groups[key]) groups[key] = [];
            groups[key].push({ id, club });
        }
        const toRemove = {};
        for (const group of Object.values(groups)) {
            if (group.length <= 1) continue;
            // 예산 큰 것 유지, 같으면 ID가 작은(오래된) 것 유지
            group.sort((a, b) => (b.club.budget || 0) - (a.club.budget || 0) || a.id.localeCompare(b.id));
            const [, ...remove] = group;
            for (const { id } of remove) {
                delete this.clubRegistry[id];
                toRemove[id] = null; // Firebase multi-path update용
            }
        }
        // 단 한 번의 update() 호출로 모든 중복 삭제 → 리스너 재호출 1회로 제한 (깜빡임 방지)
        if (Object.keys(toRemove).length > 0 && this.firebaseDb) {
            const rootUpdates = {};
            Object.entries(toRemove).forEach(([id, value]) => { rootUpdates[`clubRegistry/${id}`] = value; });
            this.appendAuditUpdate(rootUpdates, {
                action: 'DELETE',
                targetType: '중복 클럽 자동 정리',
                targetLabel: `중복 클럽 ${Object.keys(toRemove).length}개`,
                summary: `시스템이 중복 클럽 ${Object.keys(toRemove).length}개 자동 삭제`,
                details: { 삭제클럽수: Object.keys(toRemove).length }
            }, { pin: 'system', name: '시스템 자동 정리', role: '시스템' });
            this.firebaseDb.ref().update(rootUpdates).catch(() => {});
        }
    },

    // 클럽명 변경 시 globalHistory + 모든 유저 settlementHistory의 clubName 일괄 갱신
    async renameClubInHistory(clubId, oldName, newName) {
        if (!this.firebaseDb || !oldName || !newName || oldName === newName) return;
        try {
            const updates = {};

            // globalHistory 갱신 (관리자 이력 탭 기준)
            const histSnap = await this.firebaseDb.ref('globalHistory').once('value');
            histSnap.forEach(child => {
                const entry = child.val();
                if (!entry) return;
                const matchById = clubId && entry.clubId === clubId;
                const matchByName = !entry.clubId && entry.clubName === oldName;
                if (matchById || matchByName) {
                    updates[`globalHistory/${child.key}/clubName`] = newName;
                    if (clubId && !entry.clubId) updates[`globalHistory/${child.key}/clubId`] = clubId;
                }
            });

            // 각 유저의 개인 settlementHistory 갱신
            const settleSnap = await this.firebaseDb.ref('settlements').once('value');
            settleSnap.forEach(pinChild => {
                const pinData = pinChild.val();
                if (!pinData || !Array.isArray(pinData.settlementHistory)) return;
                pinData.settlementHistory.forEach((entry, idx) => {
                    if (!entry) return;
                    const matchById = clubId && entry.clubId === clubId;
                    const matchByName = !entry.clubId && entry.clubName === oldName;
                    if (matchById || matchByName) {
                        updates[`settlements/${pinChild.key}/settlementHistory/${idx}/clubName`] = newName;
                        if (clubId && !entry.clubId) updates[`settlements/${pinChild.key}/settlementHistory/${idx}/clubId`] = clubId;
                    }
                });
            });

            if (Object.keys(updates).length > 0) {
                await this.firebaseDb.ref().update(updates);
                console.log(`클럽명 이력 갱신: "${oldName}" → "${newName}" (${Object.keys(updates).length}건)`);
            }
        } catch (err) {
            console.error('클럽명 이력 갱신 실패:', err);
        }
    },

    // 현재 정산할 클럽이 실제로 선택되어 있는지 여부 ("클럽을 선택하세요" 미선택 상태는 false)
    hasSelectedClub() {
        if (this.clubId && this.clubRegistry && this.clubRegistry[this.clubId]) {
            return true;
        }
        const name = (this.clubName || '').trim();
        return Boolean(name && name !== '클럽을 선택하세요');
    },

    // 선택된 클럽의 배정 예산을 현재 사용자의 "올해 클럽 지원 총예산"에 동기화
    // 클럽 레지스트리에서 현재 선택 클럽의 예산을 직접 조회 (항상 관리자 설정값 기준)
    getClubBudget() {
        if (!this.hasSelectedClub()) return 0;
        // 1순위: clubId로 직접 조회
        if (this.clubId && this.clubRegistry[this.clubId]) {
            return this.clubRegistry[this.clubId].budget || 0;
        }
        // 2순위: 이름으로 검색
        if (this.clubName) {
            const club = Object.values(this.clubRegistry).find(c => c.name === this.clubName);
            if (club) return club.budget || 0;
        }
        return 0;
    },

    // 현재/조회 연도 내 이 클럽의 정산 이력 합산으로 실제 사용금액 계산
    getClubUsedBudget() {
        if (!this.hasSelectedClub()) return 0;
        const currentYear = new Date().getFullYear();
        const activeYear = (typeof _selectedQueryYear !== 'undefined' && _selectedQueryYear && _selectedQueryYear !== 'ALL')
            ? (parseInt(_selectedQueryYear, 10) || currentYear)
            : currentYear;
        let regEntry = null;
        if (this.clubId && this.clubRegistry[this.clubId]) {
            regEntry = this.clubRegistry[this.clubId];
        } else if (this.clubName) {
            regEntry = Object.values(this.clubRegistry).find(c => c.name === this.clubName) || null;
        }
        const isRealCurrentYear = activeYear === currentYear;
        const priorUsed = (isRealCurrentYear && regEntry) ? (regEntry.priorUsed || 0) : 0;

        // clubHistory(전체 사용자 이력)가 로드돼 있으면 우선 사용 — 없으면 개인 이력으로 fallback
        const useClubHistory = this.clubHistory.length > 0;
        const historySource = useClubHistory ? this.clubHistory : (this.settlementHistory || []);
        const fromHistory = historySource
            .filter(e => {
                if (!e || !e.date) return false;
                const entryYear = e.settlementDate
                    ? parseInt(e.settlementDate.slice(0, 4), 10)
                    : new Date(e.date).getFullYear();
                if (entryYear !== activeYear) return false;
                // clubHistory는 이미 현재 클럽 기준으로 필터됨
                if (useClubHistory) return true;
                if (this.clubId) return e.clubId === this.clubId || e.clubName === this.clubName;
                return e.clubName === this.clubName;
            })
            .reduce((sum, e) => sum + (e.finalSupportAmount || 0), 0);

        // Firebase 동기화값은 clubHistory(globalHistory)가 아직 로드되지 않았을 때만 보조로 사용
        const firebaseUsed = (isRealCurrentYear && regEntry && regEntry.usedBudget) ? regEntry.usedBudget : 0;

        let used = priorUsed + (useClubHistory ? fromHistory : Math.max(fromHistory, firebaseUsed));

        // 이력 수정 모드: 지금 수정 중인 이 이력 자신이 원래 기여했던 지원금은 "이미 사용한 금액"에서 제외
        // — 그래야 잔여예산이 "이 이력을 뺀 나머지 + 지금 새로 입력 중인 금액" 기준으로 정확히 계산됨
        // (제외하지 않으면 이 이력 자신과 비교되어 잔여예산이 실제보다 작게 표시/차단됨)
        if (this.editingHistoryId) {
            used = Math.max(0, used - (this._editingOriginalSupport || 0));
        }
        return used;
    },

    // 클럽별 정회원 명단 조회/저장은 js/regular-members.js 에서 AppState.getRegularMembersForYear / setClubRegularMembers 로 주입됨 (v1.7.63)

    // globalHistory에서 현재 클럽(또는 미선택 시 전체 클럽)의 유효 이력 로드 (관리자 페이지와 100% 동일 기준)
    async loadClubHistory() {
        const currentClubId = this.clubId;
        const currentClubName = this.clubName;
        if (!this.firebaseDb || !this.isLoggedIn) {
            this.clubHistory = (currentClubId || currentClubName)
                ? (this.settlementHistory || []).filter(e => historyMatchesClub(e, currentClubId, currentClubName))
                : [...(this.settlementHistory || [])];
            return;
        }
        try {
            const [histSnap, deletedSnap] = await Promise.all([
                this.firebaseDb.ref('globalHistory').once('value'),
                this.firebaseDb.ref('deletedHistoryIds').once('value')
            ]);
            const delMap = deletedSnap.val() || {};
            const validGlobal = extractValidGlobalHistory(histSnap.val() || {}, delMap, this.firebaseDb);

            // 개인 로컬 이력에서도 삭제된 항목이 남아 있지 않도록 정리
            if (Array.isArray(this.settlementHistory) && this.settlementHistory.length > 0) {
                this.settlementHistory = this.settlementHistory.filter(e => e && !delMap[String(e.id)]);
            }

            const allHistory = (currentClubId || currentClubName)
                ? validGlobal.filter(entry => historyMatchesClub(entry, currentClubId, currentClubName))
                : validGlobal;
            allHistory.sort(compareHistoryEntriesNewestFirst);
            this.clubHistory = allHistory;

            if (!currentClubId && !currentClubName) return;

            // 올해 이력 기준 상품비 및 usedBudget 정합성 동기화
            const currentYear = new Date().getFullYear();
            const currentYearClubEntries = allHistory.filter(entry => getHistoryEntryYear(entry) === currentYear);
            const historyPrizeTotal = currentYearClubEntries
                .reduce((sum, entry) => sum + getHistoryPrizeCost(entry), 0);
            const historySupportTotal = currentYearClubEntries
                .reduce((sum, entry) => sum + Math.max(0, parseAmount(entry.finalSupportAmount)), 0);
            const registryPair = currentClubId && this.clubRegistry[currentClubId]
                ? [currentClubId, this.clubRegistry[currentClubId]]
                : Object.entries(this.clubRegistry || {}).find(([, club]) => club && club.name === currentClubName);
            if (registryPair) {
                const [registryClubId, registryClub] = registryPair;
                const registryPrizeUsed = Math.max(0, parseAmount(registryClub.prizeUsed));
                const syncUpdates = {};
                if (historyPrizeTotal !== registryPrizeUsed) {
                    registryClub.prizeUsed = historyPrizeTotal;
                    this.previousPrizeTotal = historyPrizeTotal;
                    syncUpdates[`clubRegistry/${registryClubId}/prizeUsed`] = historyPrizeTotal;
                    if (this.yearlyClubRegistry && this.yearlyClubRegistry[currentYear] && this.yearlyClubRegistry[currentYear][registryClubId]) {
                        this.yearlyClubRegistry[currentYear][registryClubId].prizeUsed = historyPrizeTotal;
                        syncUpdates[`yearlyClubRegistry/${currentYear}/${registryClubId}/prizeUsed`] = historyPrizeTotal;
                    }
                } else {
                    this.previousPrizeTotal = registryPrizeUsed;
                }
                const registryUsedBudget = Math.max(0, parseAmount(registryClub.usedBudget));
                if (historySupportTotal !== registryUsedBudget) {
                    registryClub.usedBudget = historySupportTotal;
                    syncUpdates[`clubRegistry/${registryClubId}/usedBudget`] = historySupportTotal;
                    if (this.yearlyClubRegistry && this.yearlyClubRegistry[currentYear] && this.yearlyClubRegistry[currentYear][registryClubId]) {
                        this.yearlyClubRegistry[currentYear][registryClubId].usedBudget = historySupportTotal;
                        syncUpdates[`yearlyClubRegistry/${currentYear}/${registryClubId}/usedBudget`] = historySupportTotal;
                    }
                }
                if (Object.keys(syncUpdates).length > 0) {
                    this.firebaseDb.ref().update(syncUpdates).catch(() => {});
                }
            }
        } catch {
            this.clubHistory = (currentClubId || currentClubName)
                ? (this.settlementHistory || []).filter(e => historyMatchesClub(e, currentClubId, currentClubName))
                : [...(this.settlementHistory || [])];
        }
    },

    syncBudgetFromClub(clubName) {
        const club = Object.values(this.clubRegistry).find(c => c.name === clubName);
        if (club) {
            this.annualBudget = club.budget;
            if (this.usedBudget === 0) {
                this.usedBudget = club.priorUsed || 0;
            }
            this.save();
        }
    },

    addExpense(description, amount, category, corpChecked, personalChecked, corporateAmountInput) {
        let cardType, corpAmount, personalAmount, receiptImage, corporateReceiptImage, personalReceiptImage;
        const editingItemId = this.editingItemId;
        const previousItem = editingItemId !== null
            ? this.expenseItems.find(item => item.id === editingItemId)
            : null;

        if (corpChecked) {
            corpAmount = Math.min(Math.max(corporateAmountInput || 0, 0), amount);
            const personalAmt = amount - corpAmount;
            if (personalAmt > 0) {
                cardType = 'split';
                personalAmount = personalAmt;
                receiptImage = null;
                corporateReceiptImage = this.tempCorpReceiptImage;
                personalReceiptImage = personalChecked ? this.tempPersonalReceiptImage : null;
            } else {
                cardType = 'corporate';
                personalAmount = null;
                receiptImage = this.tempCorpReceiptImage;
                corporateReceiptImage = null;
                personalReceiptImage = null;
            }
        } else if (personalChecked) {
            cardType = 'personal';
            corpAmount = null;
            personalAmount = amount;
            receiptImage = this.tempPersonalReceiptImage;
            corporateReceiptImage = null;
            personalReceiptImage = null;
        } else {
            cardType = 'corporate';
            corpAmount = null;
            personalAmount = null;
            receiptImage = this.tempCorpReceiptImage;
            corporateReceiptImage = null;
            personalReceiptImage = null;
        }

        if (this.editingItemId !== null) {
            const index = this.expenseItems.findIndex(item => item.id === this.editingItemId);
            if (index !== -1) {
                const item = this.expenseItems[index];
                item.description = description;
                item.amount = amount;
                item.category = category;
                item.cardType = cardType;
                item.corporateAmount = corpAmount;
                item.personalAmount = personalAmount;
                item.receiptImage = receiptImage;
                item.corporateReceiptImage = corporateReceiptImage;
                item.personalReceiptImage = personalReceiptImage;
            }
        } else {
            const item = {
                id: Date.now(),
                description,
                amount,
                category,
                cardType,
                corporateAmount: corpAmount,
                personalAmount: personalAmount,
                receiptImage,
                corporateReceiptImage,
                personalReceiptImage
            };
            this.expenseItems.push(item);
        }
        // 항목이 바뀌면 자부담을 다시 항목 합계 기준으로 재계산 — 수동 오버라이드 해제
        this.selfPayManuallyOverridden = false;
        this.cancelEdit();
        this.render();
        return this.save();
    },

    deleteExpense(id) {
        this.expenseItems = this.expenseItems.filter(item => item.id !== id);
        this.selfPayManuallyOverridden = false;
        if (this.editingItemId === id) {
            this.cancelEdit();
        }
        this.save();
        this.render();
    },

    startEditExpense(id) {
        const item = this.expenseItems.find(item => item.id === id);
        if (item) {
            this.editingItemId = id;
            document.getElementById('expense-desc-input').value = item.description;
            document.getElementById('expense-amount-input').value = formatAmount(item.amount);
            document.getElementById('expense-category-select').value = item.category;

            // Card type / split payment
            const cardType = item.cardType || 'corporate';
            const corpAmount = (item.corporateAmount !== undefined && item.corporateAmount !== null)
                ? item.corporateAmount
                : (cardType === 'personal' ? 0 : item.amount);
            const personalAmount = (item.personalAmount !== undefined && item.personalAmount !== null)
                ? item.personalAmount
                : (cardType === 'corporate' ? 0 : item.amount);

            document.getElementById('expense-corp-check').checked = (cardType === 'corporate' || cardType === 'split' || corpAmount > 0);
            document.getElementById('expense-personal-check').checked = (cardType === 'personal' || cardType === 'split' || personalAmount > 0);
            document.getElementById('expense-corporate-amount-input').value = corpAmount > 0 ? formatAmount(corpAmount) : '';
            document.getElementById('expense-personal-amount-input').value = personalAmount > 0 ? formatAmount(personalAmount) : '';

            // Load receipt preview status
            this.tempCorpReceiptImage = (cardType === 'split') ? (item.corporateReceiptImage || null) : (cardType === 'corporate' ? (item.receiptImage || null) : null);
            this.tempPersonalReceiptImage = (cardType === 'split') ? (item.personalReceiptImage || null) : (cardType === 'personal' ? (item.receiptImage || null) : null);

            // ⚠️ 기존 저장된 카드 금액(수동 분할값 등)을 보존해야 하므로 autoSetTogglesAndCorp()는 호출하지 않는다.
            // 대신 수동 입력된 1인당 자부담 상태를 프리뷰에 정확히 동기화
            const memberCount = this.memberCount || (this.attendees ? this.attendees.length : 0);
            if (memberCount > 0) {
                const otherItems = (this.expenseItems || []).filter(it => it.id !== id);
                const otherSelfPay = otherItems.reduce((s, it) => s + (it.personalAmount || 0), 0);
                const totalProjSelfPay = otherSelfPay + personalAmount;
                const perPersonVal = Math.round(totalProjSelfPay / memberCount);

                const policyResult = SettlementCalculator.calculate(
                    memberCount,
                    [...otherItems, { amount: item.amount, category: item.category }],
                    0,
                    this.rules || DefaultRules
                );
                const policyPerPerson = Math.round(policyResult.totalSelfPay / memberCount);
                if (Math.abs(perPersonVal - policyPerPerson) >= 1) {
                    _manualPendingPerPerson = perPersonVal;
                } else {
                    _manualPendingPerPerson = null;
                }
            } else {
                _manualPendingPerPerson = null;
            }

            updateCardTypeUI();
            updatePendingSelfPayPreview();

            const corpStatusEl = document.getElementById('receipt-corp-status');
            const corpThumbEl = document.getElementById('receipt-corp-thumb');
            const deleteCorpBtn = document.getElementById('delete-receipt-corp-btn');
            if (this.tempCorpReceiptImage) {
                if (corpThumbEl) {
                    corpThumbEl.src = this.tempCorpReceiptImage;
                    corpThumbEl.classList.remove('hidden');
                }
                if (corpStatusEl) corpStatusEl.classList.add('hidden');
                if (deleteCorpBtn) deleteCorpBtn.classList.remove('hidden');
            } else {
                if (corpThumbEl) {
                    corpThumbEl.src = '';
                    corpThumbEl.classList.add('hidden');
                }
                if (corpStatusEl) corpStatusEl.classList.add('hidden');
                if (deleteCorpBtn) deleteCorpBtn.classList.add('hidden');
            }
            document.getElementById('expense-receipt-corp-input').value = '';

            const personalStatusEl = document.getElementById('receipt-personal-status');
            const personalThumbEl = document.getElementById('receipt-personal-thumb');
            const deletePersonalBtn = document.getElementById('delete-receipt-personal-btn');
            if (this.tempPersonalReceiptImage) {
                if (personalThumbEl) {
                    personalThumbEl.src = this.tempPersonalReceiptImage;
                    personalThumbEl.classList.remove('hidden');
                }
                if (personalStatusEl) personalStatusEl.classList.add('hidden');
                if (deletePersonalBtn) deletePersonalBtn.classList.remove('hidden');
            } else {
                if (personalThumbEl) {
                    personalThumbEl.src = '';
                    personalThumbEl.classList.add('hidden');
                }
                if (personalStatusEl) personalStatusEl.classList.add('hidden');
                if (deletePersonalBtn) deletePersonalBtn.classList.add('hidden');
            }
            document.getElementById('expense-receipt-personal-input').value = '';

            const submitBtn = document.getElementById('add-expense-btn');
            submitBtn.innerHTML = `<span class="btn-icon">💾</span> 수정 완료`;
            document.getElementById('cancel-edit-btn').classList.remove('hidden');

            document.getElementById('add-expense-card').scrollIntoView({ behavior: 'smooth' });
            document.getElementById('expense-desc-input').focus();
        }
    },

    cancelEdit() {
        this.editingItemId = null;
        _manualPendingPerPerson = null;
        document.getElementById('expense-desc-input').value = '';
        document.getElementById('expense-amount-input').value = '';
        document.getElementById('expense-category-select').selectedIndex = 0;

        document.getElementById('expense-corp-check').checked = true;
        document.getElementById('expense-personal-check').checked = false;
        document.getElementById('expense-corporate-amount-input').value = '';
        document.getElementById('expense-personal-amount-input').value = '';

        document.getElementById('expense-receipt-corp-input').value = '';
        this.tempCorpReceiptImage = null;
        document.getElementById('receipt-corp-status').classList.add('hidden');
        const corpThumbEl = document.getElementById('receipt-corp-thumb');
        if (corpThumbEl) { corpThumbEl.src = ''; corpThumbEl.classList.add('hidden'); }
        const deleteCorpBtn = document.getElementById('delete-receipt-corp-btn');
        if (deleteCorpBtn) deleteCorpBtn.classList.add('hidden');

        document.getElementById('expense-receipt-personal-input').value = '';
        this.tempPersonalReceiptImage = null;
        document.getElementById('receipt-personal-status').classList.add('hidden');
        const personalThumbEl = document.getElementById('receipt-personal-thumb');
        if (personalThumbEl) { personalThumbEl.src = ''; personalThumbEl.classList.add('hidden'); }
        const deletePersonalBtn = document.getElementById('delete-receipt-personal-btn');
        if (deletePersonalBtn) deletePersonalBtn.classList.add('hidden');

        updateCardTypeUI();
        updatePendingSelfPayPreview();

        const submitBtn = document.getElementById('add-expense-btn');
        submitBtn.innerHTML = `<span class="btn-icon">✨</span> 항목 추가`;
        document.getElementById('cancel-edit-btn').classList.add('hidden');
    },

    addAttendee(name, employeeId) {
        const editingAttendeeId = this.editingAttendeeId;
        const previousAttendee = editingAttendeeId !== null
            ? this.attendees.find(attendee => attendee.id === editingAttendeeId)
            : null;
        const normalizedEmployeeId = String(employeeId || '').trim();
        const duplicateAttendee = normalizedEmployeeId
            ? this.attendees.find(attendee =>
                attendee && String(attendee.employeeId || '').trim() === normalizedEmployeeId &&
                String(attendee.id) !== String(this.editingAttendeeId)
            )
            : null;
        if (duplicateAttendee) {
            this.showAttendeeDuplicateHint(duplicateAttendee, normalizedEmployeeId);
            return false;
        }

        this.clearAttendeeDuplicateHint();

        if (this.editingAttendeeId !== null) {
            const index = this.attendees.findIndex(att => att.id === this.editingAttendeeId);
            if (index !== -1) {
                const oldName = this.attendees[index].name;
                // If name changed, remove old directory key (preserve count on new key)
                if (oldName !== name && this.directory[oldName] !== undefined) {
                    const oldData = this.directory[oldName];
                    const oldCount = typeof oldData === 'object' ? (oldData.count || 0) : 0;
                    delete this.directory[oldName];
                    if (!this.directory[name]) {
                        this.directory[name] = { id: employeeId, count: oldCount };
                    }
                } else if (this.directory[name]) {
                    const cur = this.directory[name];
                    this.directory[name] = { id: employeeId, count: typeof cur === 'object' ? (cur.count || 0) : 0 };
                }
                this.attendees[index].name = name;
                this.attendees[index].employeeId = employeeId;
            }
        } else {
            const attendee = { id: Date.now(), name, employeeId };
            this.attendees.push(attendee);
        }

        // Ensure person exists in directory (without touching count)
        if (!this.directory[name]) {
            this.directory[name] = { id: employeeId, count: 0 };
        } else if (typeof this.directory[name] !== 'object') {
            this.directory[name] = { id: this.directory[name], count: 0 };
        }
        
        this.memberCount = this.attendees.length;

        this.cancelEditAttendee();
        this.save();
        this.render();
        this.updateDatalist();
        return true;
    },

    // 브라우저 기본 alert 대신 이름 입력란 옆에서 중복 사번을 안내한다.
    showAttendeeDuplicateHint(attendee, employeeId) {
        const hint = document.getElementById('attendee-duplicate-hint');
        const nameInput = document.getElementById('attendee-name-input');
        const idInput = document.getElementById('attendee-id-input');
        if (hint) {
            hint.textContent = `⚠ 이미 등록됨: ${attendee.name} (사번 ${employeeId})`;
            hint.classList.remove('hidden');
        }
        if (nameInput) nameInput.setAttribute('aria-invalid', 'true');
        if (idInput) idInput.setAttribute('aria-invalid', 'true');
    },

    clearAttendeeDuplicateHint() {
        const hint = document.getElementById('attendee-duplicate-hint');
        const nameInput = document.getElementById('attendee-name-input');
        const idInput = document.getElementById('attendee-id-input');
        if (hint) {
            hint.textContent = '';
            hint.classList.add('hidden');
        }
        if (nameInput) nameInput.removeAttribute('aria-invalid');
        if (idInput) idInput.removeAttribute('aria-invalid');
    },

    deleteAttendee(id) {
        this.attendees = this.attendees.filter(att => att.id !== id);
        if (this.editingAttendeeId === id) {
            this.cancelEditAttendee();
        }
        this.memberCount = this.attendees.length;
        this.save();
        this.render();
    },

    clearAttendees() {
        this.attendees = [];
        this.cancelEditAttendee();
        this.memberCount = 0;
        this.save();
        this.render();
    },

    startEditAttendee(id) {
        const attendee = this.attendees.find(att => att.id === id);
        if (attendee) {
            this.editingAttendeeId = id;
            document.getElementById('attendee-name-input').value = attendee.name;
            document.getElementById('attendee-id-input').value = attendee.employeeId;

            const submitBtn = document.getElementById('add-attendee-btn');
            submitBtn.innerHTML = `<span class="btn-icon">💾</span> 수정 완료`;
            document.getElementById('cancel-edit-attendee-btn').classList.remove('hidden');

            document.getElementById('add-attendee-card').scrollIntoView({ behavior: 'smooth' });
            document.getElementById('attendee-name-input').focus();
        }
    },

    cancelEditAttendee() {
        this.editingAttendeeId = null;
        this.clearAttendeeDuplicateHint();
        document.getElementById('attendee-name-input').value = '';
        document.getElementById('attendee-id-input').value = '';

        const submitBtn = document.getElementById('add-attendee-btn');
        submitBtn.innerHTML = `<span class="btn-icon">👥</span> 참석 추가`;
        document.getElementById('cancel-edit-attendee-btn').classList.add('hidden');
    },

    updateDatalist() {
        // 커스텀 드롭다운 방식으로 전환 — datalist는 더 이상 사용 안 함
    },

    deleteFromDirectory(name, id) {
        if (!this.hasAdminAccess) {
            alert(t('alert.directory_delete_restricted'));
            return;
        }
        try {
            const entry = this.directory[name];
            const deletedId = id || (typeof entry === 'object' ? entry?.id : entry);
            if (id && typeof entry === 'object' && Array.isArray(entry.ids) && entry.ids.length > 1) {
                // 동명이인 중 특정 사번만 제거
                entry.ids = entry.ids.filter(i => String(i) !== String(id));
                if (String(entry.id) === String(id)) entry.id = entry.ids[0];
            } else {
                delete this.directory[name];
                if (this.editingDirName === name) this.cancelEditDirectory();
            }
            if (this.firebaseDb) {
                const updates = { 'settlements/000000/directory': this.directory };
                if (this.currentPin && this.currentPin !== '000000') {
                    updates[`settlements/${this.currentPin}/directory`] = this.directory;
                }
                this.firebaseDb.ref().update(updates).catch(e => console.error("공유 명부 삭제 동기화 실패:", e));
            }
            const savePromise = this.save();
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
            console.error("Error encountered in deleteFromDirectory:", error);
        }
    },

    getMaxDirectoryAttendanceCount() {
        if (!this.directory) return 0;
        let maxCount = 0;
        Object.keys(this.directory).forEach(name => {
            const entry = this.directory[name];
            if (typeof entry === 'object' && entry.counts) {
                Object.values(entry.counts).forEach(c => {
                    const cnt = Number(c) || 0;
                    if (cnt > maxCount) maxCount = cnt;
                });
            } else if (typeof entry === 'object' && entry.count) {
                const cnt = Number(entry.count) || 0;
                if (cnt > maxCount) maxCount = cnt;
            }
        });
        return maxCount;
    },

    addDirectoryEntry(name, employeeId) {
        const previousName = this.editingDirName;
        const previousId = this.editingDirId;
        const isEditing = previousName !== null;
        const eid = String(employeeId);
        if (this.editingDirName !== null) {
            const currentData = this.directory[this.editingDirName];
            const currentCount = typeof currentData === 'object' ? (currentData.count || 0) : 1;
            const nameChanged = this.editingDirName !== name;

            if (nameChanged) {
                delete this.directory[this.editingDirName];

                const existing = this.directory[name];
                if (existing) {
                    // 대상 이름이 이미 존재 → 동명이인으로 ids[] 병합
                    if (typeof existing !== 'object') {
                        this.directory[name] = { id: String(existing), count: existing.count || 0, ids: [String(existing)] };
                    }
                    if (!this.directory[name].ids) this.directory[name].ids = [String(this.directory[name].id)];
                    if (!this.directory[name].ids.includes(eid)) this.directory[name].ids.push(eid);
                } else {
                    this.directory[name] = { id: eid, count: currentCount, ids: [eid] };
                }
            } else {
                // 이름 그대로, 특정 사번만 변경 (editingDirId → eid)
                let ids = (currentData && Array.isArray(currentData.ids)) ? currentData.ids.map(String) : [String(currentData && currentData.id ? currentData.id : eid)];
                const oldId = this.editingDirId ? String(this.editingDirId) : null;
                if (oldId && ids.includes(oldId)) {
                    ids = ids.map(i => i === oldId ? eid : i);
                } else if (!ids.includes(eid)) {
                    ids.push(eid);
                }
                const primaryId = (oldId && String(currentData.id) === oldId) ? eid : String(currentData.id || eid);
                this.directory[name] = { id: primaryId, count: currentCount, ids };
            }
        } else {
            const now = Date.now();
            const existing = this.directory[name];
            if (existing && typeof existing === 'object') {
                // 이미 존재하는 이름 → 사번 추가
                if (!existing.ids) existing.ids = [String(existing.id)];
                if (!existing.ids.includes(eid)) existing.ids.push(eid);
                if (!existing.createdAts) existing.createdAts = {};
                existing.createdAts[eid] = now;
                existing.createdAt = now;
            } else {
                this.directory[name] = { id: eid, count: 0, ids: [eid], createdAts: { [eid]: now }, createdAt: now };
            }
            try {
                localStorage.setItem(`dir_reg_${name}_${eid}`, String(now));
            } catch (e) {}
        }
        this.cancelEditDirectory();
        if (this.firebaseDb) {
            const updates = { 'settlements/000000/directory': this.directory };
            if (this.currentPin && this.currentPin !== '000000') {
                updates[`settlements/${this.currentPin}/directory`] = this.directory;
            }
            this.firebaseDb.ref().update(updates).catch(e => console.error("공유 명부 등록 동기화 실패:", e));
        }
        const savePromise = this.save();
        this.writeAuditAfterSave(savePromise, {
            action: isEditing ? 'UPDATE' : 'CREATE',
            targetType: isEditing ? '전사원 명부 변경' : '전사원 명부 등록',
            targetId: eid,
            targetLabel: `${name} (${eid})`,
            summary: isEditing
                ? `전사원 명부 수정: '${previousName} (${previousId || '-'})' → '${name} (${eid})'`
                : `전사원 명부 등록: '${name} (${eid})'`,
            details: { 이전이름: previousName, 이전사번: previousId, 변경이름: name, 변경사번: eid }
        });
        this.render();
        this.updateDatalist();
    },

    startEditDirectory(name, id) {
        if (!this.hasAdminAccess) {
            alert(t('alert.edit_restricted_admin_only'));
            return;
        }
        const data = this.directory[name];
        if (data !== undefined) {
            this.editingDirName = name;
            this.editingDirId = id ? String(id) : String(typeof data === 'object' ? data.id : data);
            const idVal = this.editingDirId;
            document.getElementById('dir-name-input').value = name;
            document.getElementById('dir-id-input').value = idVal;

            const submitBtn = document.getElementById('add-dir-btn');
            submitBtn.innerHTML = `<span class="btn-icon">💾</span> 수정 완료`;
            document.getElementById('cancel-edit-dir-btn').classList.remove('hidden');

            document.getElementById('add-dir-card').scrollIntoView({ behavior: 'smooth' });
            document.getElementById('dir-name-input').focus();
        }
    },

    cancelEditDirectory() {
        this.editingDirName = null;
        document.getElementById('dir-name-input').value = '';
        document.getElementById('dir-id-input').value = '';

        const submitBtn = document.getElementById('add-dir-btn');
        submitBtn.innerHTML = `<span class="btn-icon">🗂️</span> 사원 등록`;
        document.getElementById('cancel-edit-dir-btn').classList.add('hidden');
    },

    filterDirectoryList(rawTerm) {
        const term = (rawTerm !== undefined ? rawTerm : (this.dirSearchQuery || '')).trim().toLowerCase();
        this.dirSearchQuery = term;

        const searchInput = document.getElementById('dir-search-input');
        if (searchInput && rawTerm !== undefined && searchInput.value !== rawTerm) {
            searchInput.value = rawTerm;
        }
        const clearBtn = document.getElementById('dir-search-clear-btn');
        if (clearBtn) {
            clearBtn.classList.toggle('hidden', !term);
        }

        const container = document.getElementById('directory-container');
        const countEl = document.getElementById('directory-count');
        if (!container) return;

        const rows = container.querySelectorAll('.expense-row');
        const totalCount = rows.length;

        let matchCount = 0;
        rows.forEach(row => {
            const name = (row.dataset.dirName || '').toLowerCase();
            const id = (row.dataset.dirId || '').toLowerCase();
            const isMatch = !term || name.includes(term) || id.includes(term);
            row.style.display = isMatch ? 'flex' : 'none';
            if (isMatch) matchCount++;
        });

        // 기존 검색 결과 없음 요소 제거
        const existingNoResult = container.querySelector('#dir-search-no-result');
        if (existingNoResult) existingNoResult.remove();

        if (totalCount > 0 && matchCount === 0 && term) {
            const noResultEl = document.createElement('div');
            noResultEl.id = 'dir-search-no-result';
            noResultEl.className = 'empty-state';
            noResultEl.style.padding = '1.5rem 0';
            noResultEl.innerHTML = `<p style="font-size: 0.82rem; color: var(--text-secondary); margin: 0;">'<strong style="color:var(--text-primary);">${this.escapeHtml(term)}</strong>' 와(과) 일치하는 사원이 없습니다.</p>`;
            container.appendChild(noResultEl);
        }

        if (countEl) {
            if (!term) {
                countEl.textContent = totalCount;
            } else {
                countEl.innerHTML = `<span style="color:var(--color-secondary); font-weight:700;">${matchCount}</span><span style="font-size:0.85em; opacity:0.8;">/${totalCount}</span>`;
            }
        }
    },

    // updateRules / resetRules 는 js/rules-manager.js 로 분리됨 (v1.7.70)

    clearClubData(previousClub = null) {
        const deletedExpenseCount = this.expenseItems.length;
        const deletedAttendeeCount = this.attendees.length;
        const deletedPhotoCount = this.eventPhotos.length;
        this.expenseItems = [];
        this.attendees = [];
        this.memberCount = 0;
        this.nonMemberCount = 0;
        this.eventNote = '';
        // 상품비 연간 누적은 세션 데이터가 아니라 클럽 단위 확정값 — 0으로 지우면 연 50만원 한도
        // 검증이 "누적 0원" 기준으로 계산돼 한도 초과 등록이 통과되는 구멍이 생김 (v1.6.233)
        this.previousPrizeTotal = (this.clubId && this.clubRegistry[this.clubId])
            ? (this.clubRegistry[this.clubId].prizeUsed || 0)
            : 0;
        this.eventPhotos = [];
        this.tempCorpReceiptImage = null;
        this.tempPersonalReceiptImage = null;
        this.lastCalculatedSelfPay = 0;
        this.selfPayManuallyOverridden = false;
        this.editingItemId = null;
        this.editingAttendeeId = null;
        this.save();
        this.render();

        const memberInput = document.getElementById('member-count-input');
        const prizeInput = document.getElementById('prev-prize-input');
        if (memberInput) memberInput.value = 0;
        if (prizeInput) prizeInput.value = formatAmount(this.previousPrizeTotal);

        this.cancelEdit();
        this.cancelEditAttendee();
    },

    render() {
        if (Array.isArray(this.attendees)) {
            this.memberCount = this.attendees.length;
        }
        const result = SettlementCalculator.calculate(
            this.memberCount,
            this.expenseItems,
            this.previousPrizeTotal,
            this.rules
        );

        // 검증 실패 시 UI 경고 표시
        const calcErrBanner = document.getElementById('calc-validation-error-banner');
        if (calcErrBanner) {
            if (result._validation && !result._validation.valid) {
                calcErrBanner.textContent = '⚠️ 계산 오류 감지: ' + result._validation.errors.join(' / ');
                calcErrBanner.classList.remove('hidden');
            } else {
                calcErrBanner.classList.add('hidden');
            }
        }

        // 실제 자부담: 수동 오버라이드 중이면 그 값, 아니면 항목별 개인카드 합계(itemSelfPay) 기준 (v1.6.215+)
        const finalSelfPay = this.selfPayManuallyOverridden ? this.lastCalculatedSelfPay : Math.round(result.itemSelfPay);
        const finalSupport = result.totalCost - finalSelfPay;

        // Update Results UI
        document.getElementById('result-final-support').textContent = SettlementCalculator.formatCurrency(finalSupport);

        const selfPaySpan = document.getElementById('result-total-self-pay');
        if (selfPaySpan) {
            selfPaySpan.textContent = SettlementCalculator.formatCurrency(finalSelfPay);
        }
        const selfPayInput = document.getElementById('result-total-self-pay-input');
        if (selfPayInput) {
            selfPayInput.value = formatAmount(finalSelfPay);
            if (!this.selfPayManuallyOverridden) this.lastCalculatedSelfPay = finalSelfPay;
        }

        // 실제 인당 자부담 비용: 실제 총 자부담(finalSelfPay) ÷ 참석자 수 (계산식_명세서.md 5번 명세 준수)
        const actualPerPersonSelfPay = (this.memberCount > 0 && finalSelfPay > 0)
            ? Math.round(finalSelfPay / this.memberCount)
            : result.perPersonSelfPay;

        document.getElementById('result-per-person-self-pay').textContent = SettlementCalculator.formatCurrency(actualPerPersonSelfPay);
        updatePerPersonSelfPayIcon(actualPerPersonSelfPay);

        // 사규 최소 기준값과의 차이가 있는 경우 보조 안내 라벨 표시
        const policyNoteEl = document.getElementById('result-per-person-policy-note');
        if (policyNoteEl) {
            const minSelfPayTotal = Math.round(result.totalSelfPay);
            if (this.memberCount > 0 && finalSelfPay > 0 && Math.abs(finalSelfPay - minSelfPayTotal) >= 100) {
                policyNoteEl.textContent = `(사규 최소 기준: ${SettlementCalculator.formatCurrency(Math.round(result.perPersonSelfPay))})`;
                policyNoteEl.classList.remove('hidden');
            } else {
                policyNoteEl.classList.add('hidden');
            }
        }
        document.getElementById('result-self-pay-ratio').textContent = `${(result.totalCost > 0 ? (finalSelfPay / result.totalCost * 100) : 0).toFixed(1)}%`;
        document.getElementById('result-total-cost').textContent = SettlementCalculator.formatCurrency(result.totalCost);
        document.getElementById('result-event-cost').textContent = SettlementCalculator.formatCurrency(result.eventCost);
        document.getElementById('result-facility-cost').textContent = SettlementCalculator.formatCurrency(result.facilityCost);
        document.getElementById('result-prize-cost').textContent = SettlementCalculator.formatCurrency(result.prizeCost);
        document.getElementById('result-per-person-event-cost').textContent = SettlementCalculator.formatCurrency(result.perPersonEventCost);

        const clubBudget = this.getClubBudget();
        const clubUsed = this.getClubUsedBudget();

        const remainingBudgetRow = document.getElementById('result-club-remaining-budget');
        if (remainingBudgetRow) {
            if (clubBudget > 0) {
                remainingBudgetRow.closest('.detail-row').classList.remove('hidden');
                const remaining = clubBudget - clubUsed;
                remainingBudgetRow.textContent = SettlementCalculator.formatCurrency(remaining);
                remainingBudgetRow.style.color = remaining < 0 ? 'var(--warning-text)' : 'var(--color-secondary)';
            } else {
                remainingBudgetRow.closest('.detail-row').classList.add('hidden');
            }
        }

        // Budget remaining calculation
        const budgetSection = document.getElementById('budget-result-section');
        if (budgetSection) {
            if (clubBudget > 0) {
                const prevRemaining = clubBudget - clubUsed;
                const afterRemaining = prevRemaining - finalSupport;
                budgetSection.classList.remove('hidden');
                document.getElementById('result-prev-remaining').textContent = SettlementCalculator.formatCurrency(prevRemaining);
                document.getElementById('result-this-support-sub').textContent = SettlementCalculator.formatCurrency(finalSupport);
                document.getElementById('result-after-remaining').textContent = SettlementCalculator.formatCurrency(afterRemaining);
                document.getElementById('result-after-remaining').style.color = afterRemaining >= 0 ? 'var(--color-secondary)' : 'var(--warning-text)';
                this.updateClubBudgetProgress(clubBudget, clubUsed, finalSupport);
            } else {
                budgetSection.classList.add('hidden');
                this.updateClubBudgetProgress(0, 0, 0);
            }
        }

        // 클럽 미선택 시 정산 완료 / 정산 확정 버튼 비활성화
        const hasClubSelected = this.hasSelectedClub();
        const sendEmailBtn = document.getElementById('send-email-btn');
        if (sendEmailBtn) {
            sendEmailBtn.disabled = !hasClubSelected;
            sendEmailBtn.title = hasClubSelected ? '' : '먼저 상단에서 정산할 클럽을 선택해 주세요.';
        }
        const finalizeSettlementBtn = document.getElementById('finalize-settlement-btn');
        if (finalizeSettlementBtn) {
            finalizeSettlementBtn.disabled = !hasClubSelected;
            finalizeSettlementBtn.title = hasClubSelected ? '' : '먼저 상단에서 정산할 클럽을 선택해 주세요.';
        }

        // Event photo display
        const eventPhotoPreview = document.getElementById('event-photo-preview');
        if (eventPhotoPreview) {
            const photos = this.eventPhotos || [];
            if (photos.length > 0) {
                eventPhotoPreview.innerHTML = photos.map((src, idx) =>
                    `<div style="position:relative;display:inline-block;margin:0.2rem;"><img src="${src}" alt="행사 사진 ${idx+1}" style="height:90px;width:auto;border-radius:8px;object-fit:cover;display:block;"><button type="button" class="del-event-photo-btn" data-pidx="${idx}" style="position:absolute;top:3px;right:3px;background:rgba(239,68,68,0.9);border:none;color:#fff;border-radius:50%;width:20px;height:20px;font-size:12px;cursor:pointer;font-weight:bold;line-height:1;">&times;</button></div>`
                ).join('');
                eventPhotoPreview.classList.remove('hidden');
            } else {
                eventPhotoPreview.innerHTML = '';
                eventPhotoPreview.classList.add('hidden');
            }
        }

        const memberCountInput = document.getElementById('member-count-input');
        if (memberCountInput) {
            memberCountInput.value = this.memberCount;
        }
        const nonMemberCountInput = document.getElementById('non-member-count-input');
        if (nonMemberCountInput && document.activeElement !== nonMemberCountInput) {
            nonMemberCountInput.value = this.nonMemberCount || 0;
        }
        if (typeof window._renderEventNoteOptions === 'function') {
            window._renderEventNoteOptions();
        }

        // Update Tab badge and list labels
        const badgeCount = document.getElementById('attendee-badge-count');
        if (badgeCount) badgeCount.textContent = this.attendees.length;
        
        const listCount = document.getElementById('attendee-list-count');
        if (listCount) listCount.textContent = this.attendees.length;

        const dirBadgeCount = document.getElementById('directory-badge-count');
        if (dirBadgeCount) {
            // 사번 기준 인원수 — 명부 탭 내부 카운트(dirRows.length)와 동일 기준 (동명이인은 사번마다 1명)
            let dirIdTotal = 0;
            Object.values(this.directory).forEach(v => {
                dirIdTotal += (typeof v === 'object' && Array.isArray(v.ids) && v.ids.length > 0) ? v.ids.length : 1;
            });
            dirBadgeCount.textContent = dirIdTotal;
        }

        // 상품비: 위에는 올해 잔여 한도, 밑에는 누적액 표시 (v1.6.319)
        const prizeInput = document.getElementById('prev-prize-input');
        const prizeRemainingHint = document.getElementById('prize-remaining-hint');
        const _prizeLimit = (this.rules && this.rules.prizeLimit) || 500000;
        const _sessionPrize = (this.expenseItems || [])
            .filter(i => i.category === ExpenseCategory.PRIZE)
            .reduce((s, i) => s + (i.amount || 0), 0);
        const _priorPrize = this.previousPrizeTotal || 0;
        const _prizeLeft = Math.max(0, _prizeLimit - _priorPrize - _sessionPrize);

        if (prizeInput) {
            prizeInput.value = formatAmount(_prizeLeft);
            prizeInput.style.color = _prizeLeft <= 0 ? 'var(--warning-text, #ef4444)' : '';
        }

        if (prizeRemainingHint) {
            if (_sessionPrize > 0) {
                prizeRemainingHint.textContent = `🎁 기존 누적 ${formatAmount(_priorPrize)}원 + 이번 ${formatAmount(_sessionPrize)}원 = 누적액 ${formatAmount(_priorPrize + _sessionPrize)}원 (연 한도 ${formatAmount(_prizeLimit)}원)`;
            } else {
                prizeRemainingHint.textContent = `🎁 기존 상품비 누적액: ${formatAmount(_priorPrize)}원 (연 한도 ${formatAmount(_prizeLimit)}원)`;
            }
            prizeRemainingHint.style.color = 'var(--text-secondary, #64748b)';
        }

        // Update Warnings UI
        const warningsCard = document.getElementById('warnings-card');
        const warningsList = document.getElementById('warnings-list');
        if (!warningsList || !warningsCard) return;
        warningsList.innerHTML = '';

        if (result.warnings.length > 0) {
            result.warnings.forEach(warning => {
                const li = document.createElement('li');
                li.textContent = warning;
                warningsList.appendChild(li);
            });
            warningsCard.classList.remove('hidden');
        } else {
            warningsCard.classList.add('hidden');
        }

        // Update Expense List UI
        const listContainer = document.getElementById('expenses-list');
        listContainer.innerHTML = '';

        if (this.expenseItems.length === 0) {
            listContainer.innerHTML = `
                <div class="empty-state">
                    <span class="empty-icon">💨</span>
                    <p>${t('empty.expenses')}</p>
                </div>
            `;
        } else {
            this.expenseItems.forEach(item => {
                const row = document.createElement('div');
                row.className = 'expense-row';
                row.style.cursor = 'pointer';
                
                let receiptControlHtml = '';
                if (item.corporateReceiptImage || item.personalReceiptImage) {
                    receiptControlHtml = '';
                    if (item.corporateReceiptImage) {
                        receiptControlHtml += `
                            <div class="receipt-preview-wrapper" style="position: relative; display: inline-block; margin-right: 0.4rem;">
                                <img src="${item.corporateReceiptImage}" class="receipt-thumbnail" alt="법인카드 영수증 미리보기" data-desc="${this.escapeHtml(item.description)} (법인카드)">
                                <span style="position:absolute; bottom:-2px; left:-2px; background:rgba(15,23,42,0.85); color:#fff; font-size:9px; padding:0 3px; border-radius:4px; line-height:1.3;">법인</span>
                                <button class="btn-delete-receipt-only" data-id="${item.id}" data-type="corporate" title="법인카드 영수증 삭제" style="position: absolute; top: -5px; right: -5px; background: rgba(239, 68, 68, 0.95); border: none; color: white; border-radius: 50%; width: 16px; height: 16px; font-size: 10px; display: flex; align-items: center; justify-content: center; cursor: pointer; line-height: 1; font-weight: bold; box-shadow: 0 2px 4px rgba(0,0,0,0.3); transition: var(--transition-smooth);">&times;</button>
                            </div>
                        `;
                    }
                    if (item.personalReceiptImage) {
                        receiptControlHtml += `
                            <div class="receipt-preview-wrapper" style="position: relative; display: inline-block; margin-right: 0.5rem;">
                                <img src="${item.personalReceiptImage}" class="receipt-thumbnail" alt="개인카드 영수증 미리보기" data-desc="${this.escapeHtml(item.description)} (개인카드)">
                                <span style="position:absolute; bottom:-2px; left:-2px; background:rgba(15,23,42,0.85); color:#fff; font-size:9px; padding:0 3px; border-radius:4px; line-height:1.3;">개인</span>
                                <button class="btn-delete-receipt-only" data-id="${item.id}" data-type="personal" title="개인카드 영수증 삭제" style="position: absolute; top: -5px; right: -5px; background: rgba(239, 68, 68, 0.95); border: none; color: white; border-radius: 50%; width: 16px; height: 16px; font-size: 10px; display: flex; align-items: center; justify-content: center; cursor: pointer; line-height: 1; font-weight: bold; box-shadow: 0 2px 4px rgba(0,0,0,0.3); transition: var(--transition-smooth);">&times;</button>
                            </div>
                        `;
                    }
                } else if (item.receiptImage) {
                    receiptControlHtml = `
                        <div class="receipt-preview-wrapper" style="position: relative; display: inline-block; margin-right: 0.5rem;">
                            <img src="${item.receiptImage}" class="receipt-thumbnail" alt="영수증 미리보기" data-desc="${this.escapeHtml(item.description)}">
                            <button class="btn-delete-receipt-only" data-id="${item.id}" title="영수증만 삭제" style="position: absolute; top: -5px; right: -5px; background: rgba(239, 68, 68, 0.95); border: none; color: white; border-radius: 50%; width: 16px; height: 16px; font-size: 10px; display: flex; align-items: center; justify-content: center; cursor: pointer; line-height: 1; font-weight: bold; box-shadow: 0 2px 4px rgba(0,0,0,0.3); transition: var(--transition-smooth);">&times;</button>
                        </div>
                    `;
                } else {
                    receiptControlHtml = `<span style="font-size:0.7rem; color:var(--text-muted); opacity:0.6; margin-right:0.4rem;">영수증을 첨부하세요</span>`;
                }

                row.innerHTML = `
                    <div class="expense-row-left">
                        <span class="expense-row-title">${this.escapeHtml(item.description)}</span>
                        <div class="expense-row-meta">
                            <span class="expense-category-badge">${categoryNameMap[item.category]}</span>
                        </div>
                    </div>
                    <div class="expense-row-right">
                        ${receiptControlHtml}
                        <span class="expense-row-amount" style="margin-right: 0.5rem;">${SettlementCalculator.formatCurrency(item.amount)}</span>
                        <button class="btn-delete" data-id="${item.id}" aria-label="삭제">&times;</button>
                    </div>
                `;
                listContainer.appendChild(row);
            });

            // Bind click handlers to receipt thumbnails
            listContainer.querySelectorAll('.receipt-thumbnail').forEach(img => {
                img.addEventListener('click', (e) => {
                    const src = e.target.getAttribute('src');
                    const desc = e.target.getAttribute('data-desc');
                    
                    const modal = document.getElementById('receipt-modal');
                    const modalImg = document.getElementById('modal-img');
                    const captionText = document.getElementById('modal-caption');
                    
                    if (modal && modalImg && captionText) {
                        modal.classList.remove('hidden');
                        modalImg.src = src;
                        captionText.textContent = desc ? `${desc} 영수증` : '영수증 원본';
                    }
                });
            });


            // Bind click handlers to delete receipt only buttons
            listContainer.querySelectorAll('.btn-delete-receipt-only').forEach(button => {
                button.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const itemId = parseInt(button.getAttribute('data-id'), 10);
                    if (itemId) {
                        const index = this.expenseItems.findIndex(item => item.id === itemId);
                        if (index !== -1) {
                            const type = button.getAttribute('data-type');
                            const item = this.expenseItems[index];
                            if (type === 'corporate') {
                                item.corporateReceiptImage = null;
                            } else if (type === 'personal') {
                                item.personalReceiptImage = null;
                            } else {
                                item.receiptImage = null;
                            }
                            this.save();
                            this.render();
                        }
                    }
                });
            });

            // Bind row click handler for edit mode
            listContainer.querySelectorAll('.expense-row').forEach((row, idx) => {
                row.addEventListener('click', (e) => {
                    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('label') || e.target.closest('.receipt-thumbnail')) {
                        return;
                    }
                    const item = this.expenseItems[idx];
                    if (item) {
                        this.startEditExpense(item.id);
                    }
                });
            });

            // Bind click handlers to delete buttons
            listContainer.querySelectorAll('.btn-delete').forEach(button => {
                button.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const id = parseInt(button.getAttribute('data-id'), 10);
                    const item = this.expenseItems.find(i => i.id === id);
                    const label = item ? item.description : '이 항목';
                    showConfirmModal(`'${label}'을(를) 삭제하시겠습니까?`, () => {
                        this.deleteExpense(id);
                        if (typeof window._syncPrizeTotalFromItems === 'function') window._syncPrizeTotalFromItems();
                    });
                });
            });
        }

        // Update Attendee List UI
        const attendeesContainer = document.getElementById('attendees-container');
        if (attendeesContainer) {
            attendeesContainer.innerHTML = '';

            if (this.attendees.length === 0) {
                attendeesContainer.innerHTML = `
                    <div class="empty-state">
                        <span class="empty-icon">👥</span>
                        <p>${t('empty.attendees')}</p>
                    </div>
                `;
            } else {
                const maxAttendanceCount = this.getMaxDirectoryAttendanceCount();
                this.attendees.forEach(att => {
                    const row = document.createElement('div');
                    row.className = 'expense-row';
                    row.style.cursor = 'pointer';

                    const attEntry = this.directory[att.name];
                    const attCount = (attEntry && typeof attEntry === 'object' && attEntry.counts && att.employeeId)
                        ? (attEntry.counts[att.employeeId] || 0)
                        : 0;
                    const isAttTopRank = maxAttendanceCount > 0 && attCount === maxAttendanceCount;
                    const attCrownHtml = isAttTopRank
                        ? `<span class="crown-badge" title="올해 최다 참석 1위 왕관 (${attCount}회)" style="font-size: 1rem; line-height: 1; margin-right: 0.25rem; filter: drop-shadow(0 1px 2px rgba(234, 179, 8, 0.5));">👑</span>`
                        : '';

                    row.innerHTML = `
                        <div class="expense-row-left">
                            <span class="expense-row-title" style="display:inline-flex; align-items:center;">
                                ${attCrownHtml}<strong>${this.escapeHtml(att.name)}</strong>
                            </span>
                            <div class="expense-row-meta">
                                <span class="expense-category-badge">사번: ${this.escapeHtml(att.employeeId)}</span>
                                ${isAttTopRank ? `<span style="font-size: 0.72rem; color: #b45309; font-weight: 700; margin-left: 0.3rem;">(👑 최다 참석 1위: ${attCount}회)</span>` : ''}
                            </div>
                        </div>
                        <div class="expense-row-right">
                            <button class="btn-delete-attendee btn-delete" data-id="${att.id}" aria-label="삭제">&times;</button>
                        </div>
                    `;
                    attendeesContainer.appendChild(row);
                });

                // Bind row click handler for edit attendee mode
                attendeesContainer.querySelectorAll('.expense-row').forEach((row, idx) => {
                    row.addEventListener('click', (e) => {
                        if (e.target.closest('button')) {
                            return;
                        }
                        const att = this.attendees[idx];
                        if (att) {
                            this.startEditAttendee(att.id);
                        }
                    });
                });

                // Bind click handlers to delete attendee buttons
                attendeesContainer.querySelectorAll('.btn-delete-attendee').forEach(button => {
                    button.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const id = parseInt(button.getAttribute('data-id'), 10);
                        const att = this.attendees.find(a => a.id === id);
                        const label = att ? att.name : '이 참석자';
                        showConfirmModal(`'${label}'을(를) 참석자 목록에서 삭제하시겠습니까?`, () => {
                            this.deleteAttendee(id);
                        });
                    });
                });
            }
        }

        // Update Cumulative Directory Database UI
        const directoryCount = document.getElementById('directory-count');
        const directoryContainer = document.getElementById('directory-container');
        
        if (directoryCount && directoryContainer) {
            const dirNames = Object.keys(this.directory);
            directoryContainer.innerHTML = '';

            if (dirNames.length === 0) {
                directoryCount.textContent = 0;
                directoryContainer.innerHTML = `
                    <div class="empty-state" style="padding: 1rem 0;">
                        <p style="font-size: 0.8rem;">${t('empty.directory')}</p>
                    </div>
                `;
            } else {
                // ids[]가 여러 개면 사번마다 별도 행으로 만들고, 상단 조회 연도(_selectedQueryYear) 기준 참석 횟수를 표시
                const realCurrentYear = new Date().getFullYear();
                const activeQueryYear = (typeof _selectedQueryYear !== 'undefined' && _selectedQueryYear)
                    ? String(_selectedQueryYear)
                    : String(realCurrentYear);
                const dirYearLabel = activeQueryYear === 'ALL'
                    ? '전체 누적'
                    : (Number(activeQueryYear) === realCurrentYear ? '올해 누적' : `${activeQueryYear}년 누적`);
                const dirRows = [];
                dirNames.forEach(name => {
                    const entry = this.directory[name];
                    const ids = (typeof entry === 'object' && Array.isArray(entry.ids) && entry.ids.length > 0)
                        ? entry.ids.map(String)
                        : [String(typeof entry === 'object' ? entry.id : entry)];
                    ids.forEach(id => {
                        let countValue = 0;
                        if (this._directoryCountsByYear) {
                            if (activeQueryYear === 'ALL') {
                                Object.values(this._directoryCountsByYear).forEach(yMap => {
                                    countValue += (yMap && yMap[id]) ? yMap[id] : 0;
                                });
                            } else {
                                countValue = (this._directoryCountsByYear[activeQueryYear] && this._directoryCountsByYear[activeQueryYear][id]) || 0;
                            }
                        } else if (activeQueryYear === String(realCurrentYear) || activeQueryYear === 'ALL') {
                            countValue = (typeof entry === 'object' && entry.counts) ? (entry.counts[id] || 0) : 0;
                        }
                        dirRows.push({ name, id, count: countValue });
                    });
                });
                // 사번 각자의 참석 횟수 기준 내림차순 — 동명이인이 한 명만 참석해도 다른 사번이 따라 올라오지 않음
                dirRows.sort((a, b) => {
                    if (b.count !== a.count) return b.count - a.count;
                    return a.name.localeCompare(b.name, 'ko') || a.id.localeCompare(b.id);
                });
                directoryCount.textContent = dirRows.length;

                // 최다 참석 횟수 (1회 이상 참석자 중에서 1위 판정, 공동 1등 포함)
                const maxAttendanceCount = (dirRows.length > 0 && dirRows[0].count > 0) ? dirRows[0].count : 0;

                const canDeleteDir = Boolean(this.hasAdminAccess);
                const ONE_DAY_MS = 24 * 60 * 60 * 1000;
                const nowTime = Date.now();

                dirRows.forEach(({ name, id, count: countValue }) => {
                    const isTopRank = maxAttendanceCount > 0 && countValue === maxAttendanceCount;

                    const row = document.createElement('div');
                    row.className = 'expense-row' + (isTopRank ? ' top-attendee-row' : '');
                    row.dataset.dirName = name;
                    row.dataset.dirId = id;
                    row.style.padding = '0.5rem 0.75rem';
                    row.style.cursor = 'pointer';
                    if (isTopRank) {
                        row.style.background = 'linear-gradient(135deg, rgba(245, 158, 11, 0.09), rgba(251, 191, 36, 0.04))';
                        row.style.borderColor = 'rgba(245, 158, 11, 0.45)';
                        row.style.boxShadow = '0 0 10px rgba(245, 158, 11, 0.15)';
                    }

                    const entry = this.directory[name];
                    let regTime = (typeof entry === 'object' && entry.createdAts) ? (entry.createdAts[id] || 0) : 0;
                    if (!regTime && typeof entry === 'object' && entry.createdAt) {
                        regTime = entry.createdAt;
                    }
                    if (!regTime) {
                        try {
                            const cached = localStorage.getItem(`dir_reg_${name}_${id}`);
                            if (cached) regTime = Number(cached) || 0;
                        } catch (e) {}
                    }
                    const isNew = regTime > 0 && (nowTime - regTime < ONE_DAY_MS);
                    const newBadgeHtml = isNew
                        ? `<span class="badge-new-dir" style="padding: 0.2rem 0.5rem; font-size: 0.72rem; font-weight: 700; color: #38bdf8; background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 6px; letter-spacing: -0.02em; display: inline-flex; align-items: center; gap: 0.25rem;">✨ 신규 등록</span>`
                        : '';

                    const deleteDirBtnHtml = canDeleteDir
                        ? `<button class="btn-delete-from-directory btn-delete btn-text-danger" data-name="${this.escapeHtml(name)}" data-id="${this.escapeHtml(id)}" style="padding: 0.5rem; font-size: 1.1rem; width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; background: rgba(239, 68, 68, 0.1); margin-left: 0.5rem;" title="명부에서 삭제">&times;</button>`
                        : '';

                    const crownHtml = isTopRank
                        ? `<span class="crown-badge" title="👑 올해 최다 참석 1위 왕관 (${countValue}회)" style="display: inline-flex; align-items: center; justify-content: center; font-size: 1.05rem; line-height: 1; margin-right: 0.25rem; filter: drop-shadow(0 1px 2px rgba(234, 179, 8, 0.6)); vertical-align: middle;">👑</span>`
                        : '';

                    row.innerHTML = `
                        <div class="expense-row-left">
                            <span class="expense-row-title" style="font-size: 0.88rem; display: inline-flex; align-items: center;">
                                ${crownHtml}<button type="button" class="btn-dir-member-history" data-name="${this.escapeHtml(name)}" data-id="${this.escapeHtml(id)}" data-count="${countValue}" style="background:none; border:none; padding:0; margin:0; font:inherit; font-weight:700; color:inherit; cursor:pointer; text-decoration:underline; text-decoration-style:dotted; text-underline-offset:3px;">${this.escapeHtml(name)}</button>
                                <span class="dir-year-count-badge ${isTopRank ? 'is-top' : ''}">(${dirYearLabel}: ${countValue}회)</span>
                            </span>
                            <span style="font-size: 0.75rem; color: var(--text-secondary);">EMP ID: ${this.escapeHtml(id)}</span>
                        </div>
                        <div class="expense-row-right" style="gap: 0.4rem; align-items: center;">
                            ${isTopRank ? `<span class="badge-top-rank" style="padding: 0.18rem 0.45rem; font-size: 0.68rem; font-weight: 800; color: #b45309; background: rgba(245, 158, 11, 0.16); border: 1px solid rgba(245, 158, 11, 0.4); border-radius: 6px; letter-spacing: -0.02em; display: inline-flex; align-items: center; gap: 0.2rem;">👑 1위</span>` : ''}
                            ${newBadgeHtml}
                            ${deleteDirBtnHtml}
                        </div>
                    `;
                    directoryContainer.appendChild(row);
                });

                // Bind hover + click handlers for member name -> show club attendance breakdown tooltip/modal
                directoryContainer.querySelectorAll('.btn-dir-member-history').forEach(btn => {
                    const mName = btn.getAttribute('data-name');
                    const mId = btn.getAttribute('data-id');
                    const mCount = Number(btn.getAttribute('data-count')) || 0;
                    btn.addEventListener('mouseenter', () => {
                        if (typeof window.showDirMemberHoverTooltip === 'function') {
                            window.showDirMemberHoverTooltip(btn, mName, mId, mCount);
                        }
                    });
                    btn.addEventListener('mouseleave', () => {
                        if (typeof window.hideDirMemberHoverTooltip === 'function') {
                            window.hideDirMemberHoverTooltip();
                        }
                    });
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (typeof window.hideDirMemberHoverTooltip === 'function') window.hideDirMemberHoverTooltip();
                        if (typeof window.openDirMemberClubHistoryModal === 'function') {
                            window.openDirMemberClubHistoryModal(mName, mId, mCount);
                        }
                    });
                });

                // Bind row click handler for edit directory mode
                directoryContainer.querySelectorAll('.expense-row').forEach(row => {
                    row.addEventListener('click', (e) => {
                        if (e.target.closest('button') || e.target.closest('input')) return;
                        const dirName = row.dataset.dirName;
                        const dirId = row.dataset.dirId;
                        if (dirName) this.startEditDirectory(dirName, dirId);
                    });
                });



                // Bind click handlers to delete from directory buttons
                directoryContainer.querySelectorAll('.btn-delete-from-directory').forEach(button => {
                    button.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const name = button.getAttribute('data-name');
                        const id = button.getAttribute('data-id');
                        if (name) showConfirmModal(`'${name}'을(를) 전사원 명부에서 삭제하시겠습니까?`, () => {
                            this.deleteFromDirectory(name, id);
                        });
                    });
                });

                // 현재 검색어가 있는 경우 실시간 필터 적용 유지
                this.filterDirectoryList(this.dirSearchQuery || '');
            }
        }

        // Render Settlement History tab
        const historyContainer = document.getElementById('history-container');
        if (historyContainer) {
            historyContainer.innerHTML = '';
            // clubHistory가 비어 있어도 개인 이력 전체로 되돌아가지 않고 현재 클럽 항목만 표시한다.
            // (해당 클럽 이력이 0건일 때 다른 클럽 이력이 노출되던 회귀 방지)
            const historySource = this.clubHistory.length > 0 ? this.clubHistory : (this.settlementHistory || []);
            const historyList = (this.clubId || this.clubName)
                ? historySource.filter(entry => historyMatchesClub(entry, this.clubId, this.clubName))
                : historySource;
            if (historyList.length === 0) {
                historyContainer.innerHTML = `<div class="empty-state"><span class="empty-icon">📋</span><p>${t('empty.history')}</p></div>`;
            } else if (typeof window.createInlineClubUsageSummary === 'function') {
                // 사용자는 선택한 클럽의 공유 이력을 바로 확인하고, 로그인한 회원은 작성자와 관계없이 수정할 수 있다.
                // 상단 전역 조회 연도(_selectedQueryYear) 기준 자동 필터링
                const userYearSelect = document.getElementById('user-history-year-select');
                const selectedUserYear = (typeof _selectedQueryYear !== 'undefined' && _selectedQueryYear)
                    ? _selectedQueryYear
                    : (userYearSelect ? userYearSelect.value : String(new Date().getFullYear()));
                if (userYearSelect) {
                    userYearSelect.value = selectedUserYear;
                }

                const entriesByClub = new Map();
                historyList.forEach(entry => {
                    const clubName = entry.clubName || t('label.default_club');
                    if (!entriesByClub.has(clubName)) entriesByClub.set(clubName, []);
                    entriesByClub.get(clubName).push(entry);
                });
                const canEditSharedHistory = this.isLoggedIn;

                let renderedCards = 0;
                entriesByClub.forEach((clubEntries, clubName) => {
                    const targetEntries = clubEntries.filter(entry => {
                        if (selectedUserYear === 'ALL') return true;
                        return getHistoryEntryYear(entry) === Number(selectedUserYear);
                    });
                    if (targetEntries.length === 0) return;

                    renderedCards++;
                    const yearLabel = selectedUserYear === 'ALL' ? '전체' : `${selectedUserYear}년`;
                    const clubCard = document.createElement('section');
                    clubCard.className = 'admin-inline-club-usage-card user-inline-club-usage-card';
                    const header = document.createElement('div');
                    header.className = 'admin-inline-club-usage-header';
                    const heading = document.createElement('div');
                    heading.className = 'admin-history-club-heading';
                    const title = document.createElement('strong');
                    title.textContent = `📁 ${clubName} 사용 요약`;
                    const count = document.createElement('span');
                    count.className = 'admin-history-club-count';
                    count.textContent = `${yearLabel} 정산 ${targetEntries.length}건`;
                    heading.append(title, count);
                    header.appendChild(heading);
                    clubCard.append(
                        header,
                        window.createInlineClubUsageSummary(clubName, targetEntries, selectedUserYear === 'ALL' ? '전체' : Number(selectedUserYear), {
                            editableDates: canEditSharedHistory,
                            // 작성자와 상관없이 모든 회원이 해당 건의 엑셀을 다시 다운로드 및 삭제 가능 (삭제 시 감사 로그 자동 기록)
                            excelDownloads: true,
                            deleteEntries: Boolean(AppState.isLoggedIn)
                        })
                    );
                    historyContainer.appendChild(clubCard);
                });
                if (renderedCards === 0) {
                    const emptyLabel = selectedUserYear === 'ALL' ? '등록된' : `${selectedUserYear}년 등록된`;
                    historyContainer.innerHTML = `<div class="empty-state"><span class="empty-icon">📋</span><p>${emptyLabel} 정산 이력이 없습니다.</p></div>`;
                }
            } else {
                // 사용자 이력도 클럽별 그룹으로 표시한다. 현재 선택된 클럽이 하나면 해당 그룹만 보인다.
                const groupContainers = new Map();
                const entriesByClub = new Map();
                historyList.forEach(entry => {
                    const clubName = entry.clubName || t('label.default_club');
                    if (!entriesByClub.has(clubName)) entriesByClub.set(clubName, []);
                    entriesByClub.get(clubName).push(entry);
                });

                entriesByClub.forEach((clubEntries, clubName) => {
                    const group = document.createElement('details');
                    group.className = 'admin-history-club-group user-history-club-group';
                    group.open = true;

                    const summary = document.createElement('summary');
                    const heading = document.createElement('div');
                    heading.className = 'admin-history-club-heading';
                    const title = document.createElement('strong');
                    title.textContent = `📁 ${clubName}`;
                    const count = document.createElement('span');
                    count.className = 'admin-history-club-count';
                    count.textContent = `정산 ${clubEntries.length}건`;
                    heading.append(title, count);

                    const summaryButton = document.createElement('button');
                    summaryButton.type = 'button';
                    summaryButton.className = 'admin-history-club-summary-btn';
                    summaryButton.textContent = '📊 사용 요약';
                    summaryButton.addEventListener('click', event => {
                        event.preventDefault();
                        event.stopPropagation();
                        const currentYear = new Date().getFullYear();
                        const currentYearEntries = clubEntries.filter(entry => getHistoryEntryYear(entry) === currentYear);
                        openClubUsageSummaryModal(clubName, currentYearEntries, currentYear);
                    });
                    summary.append(heading, summaryButton);

                    const list = document.createElement('div');
                    list.className = 'admin-history-club-list';
                    group.append(summary, list);
                    historyContainer.appendChild(group);
                    groupContainers.set(clubName, list);
                });

                historyList.forEach((entry) => {
                    // 정산 날짜(settlementDate) 우선, 없으면 등록 시각(date) 표시
                    let dateStr;
                    if (entry.settlementDate) {
                        const [sy, sm, sd] = entry.settlementDate.split('-');
                        dateStr = `${sy}.${sm}.${sd}`;
                    } else {
                        const d = new Date(entry.date);
                        dateStr = `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
                    }
                    const card = document.createElement('div');
                    card.className = 'history-entry';

                    const itemsHtml = (entry.expenseItems || []).map(it => {
                        const categoryLabel = categoryNameMap[it.category] || '미분류';
                        return `<li><span>${this.escapeHtml(it.description)} (${categoryLabel})</span><span style="color:var(--color-secondary)">${SettlementCalculator.formatCurrency(it.amount)}</span></li>`;
                    }).join('');
                    const attendeesHtml = (entry.attendees || []).map(a => {
                        const empIdStr = a.employeeId ? `<span style="font-size:0.68rem;color:var(--text-muted);margin-left:2px;">(${AppState.escapeHtml(String(a.employeeId))})</span>` : '';
                        return `<span class="expense-category-badge">${this.escapeHtml(a.name)}${empIdStr}</span>`;
                    }).join(' ');
                    const attendeeCount = Number.isFinite(Number(entry.memberCount))
                        ? Number(entry.memberCount)
                        : (entry.attendees || []).length;
                    const historyPrizeCost = getHistoryPrizeCost(entry);
                    const prizeSummaryHtml = historyPrizeCost > 0
                        ? `<div class="history-stat history-stat-prize"><span>${t('hist.prize_cost')}</span><strong>${SettlementCalculator.formatCurrency(historyPrizeCost)}</strong></div>`
                        : '';

                    const editedBadge = entry.isEdited
                        ? `<span class="badge-edited">${t('badge.edited')}</span>`
                        : '';
                    // 수정 시각은 날짜+시간 모두 표시
                    const editedAtStr = entry.isEdited && entry.editedAt
                        ? (() => {
                            const ea = new Date(entry.editedAt);
                            const eaStr = `${ea.getFullYear()}.${String(ea.getMonth()+1).padStart(2,'0')}.${String(ea.getDate()).padStart(2,'0')} ${String(ea.getHours()).padStart(2,'0')}:${String(ea.getMinutes()).padStart(2,'0')}`;
                            return ` <span style="font-size:0.75rem;color:var(--text-muted);">(수정: ${eaStr})</span>`;
                        })()
                        : '';

                    // 정산인 표시 (본인이면 '나', 타인이면 이름)
                    const canEditHistory = this.isLoggedIn;
                    const creatorLabel = entry.creatorName
                        ? `<span style="font-size:0.72rem;color:var(--text-muted);white-space:nowrap;">👤 ${this.escapeHtml(entry.creatorName)}</span>`
                        : '';

                    // 로그인한 회원은 선택한 클럽의 공유 이력을 수정할 수 있다. 삭제는 관리자 전용이다.
                    const editBtnHtml = canEditHistory
                        ? `<button class="btn-edit-history" data-id="${entry.id}" style="font-size:0.75rem;padding:0.2rem 0.6rem;background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.4);color:#a5b4fc;border-radius:0.3rem;cursor:pointer;white-space:nowrap;">✏️ ${t('btn.edit')}</button>`
                        : '';

                    card.innerHTML = `
                        <div class="history-header">
                            <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
                                <span class="history-date">${dateStr}</span>
                                <!-- 클럽명은 상단 그룹 헤더에서 표시 -->
                                ${creatorLabel}
                                ${editedBadge}${editedAtStr}
                            </div>
                            <div style="display:flex;gap:0.3rem;flex-shrink:0;">
                                <button class="btn-download-history" data-id="${entry.id}" style="font-size:0.75rem;padding:0.2rem 0.6rem;background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.4);color:#6ee7b7;border-radius:0.3rem;cursor:pointer;white-space:nowrap;">📥 엑셀</button>
                                ${editBtnHtml}
                            </div>
                        </div>
                        <div class="history-summary">
                            <div class="history-stat"><span>${t('hist.attendees')}</span><strong>${entry.memberCount}${t('unit.person')}</strong></div>
                            <div class="history-stat"><span>${t('hist.total_cost')}</span><strong>${SettlementCalculator.formatCurrency(entry.totalCost)}</strong></div>
                            <div class="history-stat"><span>${t('hist.final_support')}</span><strong style="color:var(--color-secondary)">${SettlementCalculator.formatCurrency(entry.finalSupportAmount)}</strong></div>
                            <div class="history-stat"><span>${t('hist.self_pay')}</span><strong style="color:var(--warning-text)">${SettlementCalculator.formatCurrency(entry.totalSelfPay)}</strong></div>
                            ${prizeSummaryHtml}
                        </div>
                        <details class="history-details">
                            <summary>${t('hist.view_details')}</summary>
                            <ul class="history-items">${itemsHtml || `<li>${t('hist.no_items')}</li>`}</ul>
                            <details class="history-attendees-details">
                                <summary>참석자 명단 (${attendeeCount}${t('unit.person')})</summary>
                                <div class="history-attendee-list">${attendeesHtml || t('hist.no_attendees')}</div>
                            </details>
                        </details>
                    `;
                    const clubName = entry.clubName || t('label.default_club');
                    const targetContainer = groupContainers.get(clubName) || historyContainer;
                    targetContainer.appendChild(card);
                });

                // 엑셀 다운로드 버튼 이벤트
                historyContainer.querySelectorAll('.btn-download-history').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const id = Number(btn.getAttribute('data-id'));
                        const entry = historyList.find(e => e.id === id);
                        if (!entry) return;
                        btn.disabled = true;
                        btn.textContent = '⏳';
                        try {
                            await AppState.downloadHistoryExcel(entry);
                        } finally {
                            btn.disabled = false;
                            btn.textContent = '📥 엑셀';
                        }
                    });
                });

                // 수정 버튼 이벤트 (본인 항목만 렌더링됨)
                historyContainer.querySelectorAll('.btn-edit-history').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const id = Number(btn.getAttribute('data-id'));
                        const entry = AppState.settlementHistory.find(e => e.id === id);
                        if (entry) AppState.loadHistoryEntryForEdit(entry);
                    });
                });
            }
        }

        // 정적 data-i18n 요소 동기화 (언어 변경 시 즉시 반영)
        if (typeof applyTranslations === 'function') applyTranslations();
        if (typeof updatePendingSelfPayPreview === 'function') updatePendingSelfPayPreview();
    },

    updateClubBudgetProgress(clubBudget, clubUsed, finalSupport) {
        const cardEl = document.getElementById('club-budget-progress-card');
        if (!cardEl) return;
        if (!this.hasSelectedClub() || !clubBudget || clubBudget <= 0) {
            cardEl.classList.add('hidden');
            return;
        }
        cardEl.classList.remove('hidden');

        const nameEl = document.getElementById('club-progress-name');
        const barPrevEl = document.getElementById('club-progress-bar-prev');
        const barThisEl = document.getElementById('club-progress-bar-this');
        const pctEl = document.getElementById('club-progress-pct');
        const totalEl = document.getElementById('club-progress-total');
        const usedEl = document.getElementById('club-progress-used');
        const remainingEl = document.getElementById('club-progress-remaining');

        let clubName = '';
        if (this.clubRegistry && this.clubId && this.clubRegistry[this.clubId]) {
            clubName = this.clubRegistry[this.clubId].name || '';
        }
        if (!clubName) clubName = this.clubName || '클럽';

        // 클럽 고유 색상 배정
        const colorMap = (typeof getClubColorMap === 'function') ? getClubColorMap() : {};
        let clubColor = colorMap[clubName];
        if (!clubColor && typeof clubColorFor === 'function') {
            clubColor = clubColorFor(clubName, colorMap, 1.0);
        }
        if (!clubColor) clubColor = '#df8238';

        if (nameEl) {
            nameEl.textContent = clubName;
            nameEl.style.color = clubColor;
            nameEl.title = clubName;
        }

        if (totalEl) {
            totalEl.textContent = `배정 ${SettlementCalculator.formatCurrency(clubBudget)}`;
        }

        // 현재 작성 중인 건은 실시간 반영하지 않고, 정산 완료 버튼 클릭 후 DB에 업데이트되었을 때만 반영 (v1.6.319)
        const settledUsed = Math.max(0, clubUsed || 0);
        const settledRemaining = clubBudget - settledUsed;
        const settledPct = (settledUsed / clubBudget) * 100;
        const boundedPct = Math.min(100, Math.max(0, settledPct));

        // 소진율에 따른 위험 색상 (100% 초과 시 경고 레드, 그 외 클럽 고유 색상)
        const baseColor = settledPct > 100 ? '#ef4444' : clubColor;

        if (barPrevEl) {
            barPrevEl.style.width = `${boundedPct.toFixed(1)}%`;
            barPrevEl.style.backgroundColor = baseColor;
        }
        if (barThisEl) {
            barThisEl.style.width = '0%';
            barThisEl.style.display = 'none';
        }
        if (pctEl) {
            pctEl.textContent = `${settledPct.toFixed(1)}%`;
            if (settledPct < 16) {
                pctEl.style.color = 'var(--text-primary, #1e293b)';
                pctEl.style.textShadow = 'none';
            } else {
                pctEl.style.color = '#ffffff';
                pctEl.style.textShadow = '0 1px 2px rgba(0, 0, 0, 0.6)';
            }
        }

        if (usedEl) {
            usedEl.textContent = SettlementCalculator.formatCurrency(settledUsed);
        }
        if (remainingEl) {
            remainingEl.textContent = SettlementCalculator.formatCurrency(settledRemaining);
            remainingEl.style.color = settledRemaining < 0 ? 'var(--warning-text, #ff6b6b)' : 'var(--color-secondary)';
        }
    },

    // 이메일 보고서 생성·발송 및 파일 공유/다운로드 (js/email-report.js 로 분리됨, v1.7.65)

    // 중복 정산 검증 / 정산 확정 (js/settlement-history.js 로 분리됨, v1.7.64)

    escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/&/g, "&amp;")
                  .replace(/</g, "&lt;")
                  .replace(/>/g, "&gt;")
                  .replace(/"/g, "&quot;")
                  .replace(/'/g, "&#039;");
    }
};
window.AppState = AppState;

// --- 4. Event Listeners & Initialization ---

// 현재 정산 세션(비용 항목/참석자/인원/상품비 누적 등)을 전부 초기화 — "정산 초기화" 버튼과
// 정산 이력 수정 완료 후 공통으로 사용 (v1.6.229)
function resetSettlementSession(auditEvent = null) {
    AppState.expenseItems = [];
    AppState.attendees = [];
    AppState.memberCount = 0;
    AppState.nonMemberCount = 0;
    AppState.eventNote = '';
    // 상품비 연간 누적은 클럽 단위 확정값 — 0으로 지우지 않고 clubRegistry 기준으로 복원 (v1.6.233)
    AppState.previousPrizeTotal = (AppState.clubId && AppState.clubRegistry[AppState.clubId])
        ? (AppState.clubRegistry[AppState.clubId].prizeUsed || 0)
        : 0;
    AppState.lastCalculatedSelfPay = 0;
    AppState.selfPayManuallyOverridden = false;
    AppState.eventPhotos = [];
    AppState.cancelEdit();
    if (typeof AppState.cancelEditAttendee === 'function') AppState.cancelEditAttendee();
    document.getElementById('prev-prize-input').value = formatAmount(AppState.previousPrizeTotal);
    if (typeof updateCardTypeUI === 'function') updateCardTypeUI();
    const settleDateEl = document.getElementById('settlement-date-input');
    if (settleDateEl) settleDateEl.value = formatLocalDateYMD();
    if (typeof window._onSettleDateReset === 'function') window._onSettleDateReset();
    const savePromise = AppState.save();
    if (auditEvent) AppState.writeAuditAfterSave(savePromise, auditEvent);
    AppState.render();
    return savePromise;
}

document.addEventListener('DOMContentLoaded', () => {
    // Firebase 인증·권한 리스너·공유 로더 장착 (js/auth-firebase.js, v1.7.69)
    if (typeof window.__installAuthFirebaseState === 'function') {
        window.__installAuthFirebaseState(AppState);
    }
    // 연도별 정산 구간·비율 설정 상태 메서드 장착 (js/rules-manager.js, v1.7.70)
    if (typeof window.__installRulesState === 'function') {
        window.__installRulesState(AppState);
    }

    // 언어 설정 초기 적용
    if (typeof applyTranslations === 'function') applyTranslations();


    // 현재 정산 초기화 버튼
    const resetSessionBtn = document.getElementById('reset-session-btn');
    const resetSessionModal = document.getElementById('reset-session-modal');
    const resetSessionConfirmBtn = document.getElementById('reset-session-confirm-btn');
    const resetSessionCancelBtn = document.getElementById('reset-session-cancel-btn');
    if (resetSessionBtn && resetSessionModal) {
        resetSessionBtn.addEventListener('click', () => resetSessionModal.classList.remove('hidden'));
        resetSessionCancelBtn.addEventListener('click', () => resetSessionModal.classList.add('hidden'));
        resetSessionModal.addEventListener('click', (e) => {
            if (e.target === resetSessionModal) resetSessionModal.classList.add('hidden');
        });
        resetSessionConfirmBtn.addEventListener('click', () => {
            resetSessionModal.classList.add('hidden');
            resetSettlementSession();
        });
    }

    // 정산 날짜 입력 필드 오늘 날짜로 초기화
    const settleDateEl = document.getElementById('settlement-date-input');
    if (settleDateEl) settleDateEl.value = formatLocalDateYMD();
    if (typeof window._onSettleDateReset === 'function') window._onSettleDateReset();

    // PIN 키패드 클릭이 항상 동작하도록 가장 먼저 위임 방식으로 등록
    // (이후 초기화 코드에서 오류가 발생해도 키패드 입력은 막히지 않음)
    document.addEventListener('click', (e) => {
        const key = e.target.closest && e.target.closest('.pin-key');
        if (key) {
            try {
                handlePinKeyPress(key.getAttribute('data-value'));
            } catch (err) {
                console.error('PIN 키패드 처리 오류:', err);
            }
        }
    });

    // Load state from local storage
    AppState.load();

    // 번들된 전사원 데이터 중 아직 명부에 없는 사람을 자동 등록
    fetch('./lib/employee_directory.json?_=' + Date.now(), { cache: 'no-store' })
        .then(res => res.json())
        .then(list => AppState.bulkImportDirectory(list))
        .catch(err => console.error("전사원 명부 자동 등록 실패:", err));

    // Club name dropdown init
    const clubNameInput = document.getElementById('club-name-select');

    function renderClubOptions() {
        if (!clubNameInput) return;

        // clubId 기준으로 현재 클럽명 갱신 (관리자 이름 변경 반영)
        if (AppState.clubId && AppState.clubRegistry[AppState.clubId]) {
            AppState.clubName = AppState.clubRegistry[AppState.clubId].name;
        }

        const current = AppState.clubName || '';
        const clubs = Object.values(AppState.clubRegistry || {});

        // 현재 선택된 클럽이 레지스트리에 없으면 조용히 초기화만 (팝업 없음)
        // 실제 삭제 감지 및 팝업은 loadClubRegistry의 clubId 기반 로직이 처리
        // — clubId 없는 구버전 데이터 or 이름 변경 직후 타이밍 등에서 오탐 방지
        if (current && !clubs.some(c => c.name === current)) {
            AppState.clubName = '';
            AppState.clubId = '';
            AppState.save();
        }

        clubNameInput.innerHTML = `<option value="">${t('header.club_placeholder')}</option>`;
        clubs.forEach(club => {
            const opt = document.createElement('option');
            opt.value = club.name;
            opt.textContent = club.name;
            clubNameInput.appendChild(opt);
        });
        const newOpt = document.createElement('option');
        newOpt.value = '__new__';
        newOpt.textContent = t('header.club_new');
        clubNameInput.appendChild(newOpt);
        clubNameInput.value = AppState.clubName || '';
    }

    const newClubInputRow = document.getElementById('new-club-input-row');
    const newClubNameInput = document.getElementById('new-club-name-input');
    const registerNewClubBtn = document.getElementById('register-new-club-btn');
    const cancelNewClubBtn = document.getElementById('cancel-new-club-btn');

    const closeNewClubInput = () => {
        if (newClubNameInput) newClubNameInput.value = '';
        if (newClubInputRow) newClubInputRow.classList.add('hidden');
        if (clubNameInput) clubNameInput.value = AppState.clubName || '';
    };
    if (cancelNewClubBtn) {
        cancelNewClubBtn.addEventListener('click', closeNewClubInput);
    }
    if (newClubNameInput) {
        newClubNameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeNewClubInput();
        });
    }

    // 클럽이 삭제/미존재 시 팝업 (window에 등록해 AppState 내부에서도 호출 가능)
    window.showClubNotFoundModal = function() {
        const modal = document.getElementById('club-not-found-modal');
        if (modal) modal.classList.remove('hidden');
    };
    const clubNotFoundOkBtn = document.getElementById('club-not-found-ok-btn');
    if (clubNotFoundOkBtn) {
        clubNotFoundOkBtn.addEventListener('click', () => {
            const modal = document.getElementById('club-not-found-modal');
            if (modal) modal.classList.add('hidden');
        });
    }

    // 클럽 레지스트리 실시간 업데이트 콜백 (loadClubRegistry의 on('value') 리스너에서 호출)
    window._onClubRegistryUpdate = () => {
        renderClubOptions();
        if (typeof renderClubManagement === 'function') renderClubManagement();
        const chartsTab = document.getElementById('tab-charts');
        if (chartsTab && !chartsTab.classList.contains('hidden') && typeof renderAllCharts === 'function') {
            renderAllCharts(lastHistoryList || []);
        }
    };

    if (clubNameInput) {
        renderClubOptions();
        clubNameInput.addEventListener('change', () => {
            if (clubNameInput.value === '__new__') {
                if (newClubInputRow) newClubInputRow.classList.remove('hidden');
                if (newClubNameInput) newClubNameInput.focus();
                return;
            }
            if (newClubInputRow) newClubInputRow.classList.add('hidden');
            if (AppState.clubName !== clubNameInput.value) {
                const previousClub = { id: AppState.clubId, name: AppState.clubName };
                AppState.clubName = clubNameInput.value;
                const selectedEntry = Object.entries(AppState.clubRegistry || {}).find(([, c]) => c.name === clubNameInput.value);
                AppState.clubId = selectedEntry ? selectedEntry[0] : '';
                // 클럽 전환 시 상품비 누적을 해당 클럽의 확정 누적으로 동기화
                const selectedClub = selectedEntry ? selectedEntry[1] : null;
                AppState.previousPrizeTotal = selectedClub ? (selectedClub.prizeUsed || 0) : 0;
                if (prizeInput) prizeInput.value = formatAmount(AppState.previousPrizeTotal);
                AppState.usedBudget = 0;
                AppState.clubHistory = [];
                // 이전에 유효한 클럽이 지정되어 있었던 경우에만 기존 작업 내용을 정리 (초기 미지정 상태에서 클럽을 최초 선택할 때는 입력한 참석자/내역 보존)
                if (previousClub.name) {
                    AppState.clearClubData(previousClub);
                }
            }
            AppState.syncBudgetFromClub(AppState.clubName);
            AppState.save();
            setSettingsFormValues(AppState.rules);
            // 클럽 전환 시 globalHistory에서 전체 이력 로드 → 잔여 예산 즉시 반영
            AppState.loadClubHistory().then(() => AppState.render());
            if (typeof setAdminRulesFormValues === 'function') setAdminRulesFormValues(AppState.rules);
        });

        if (AppState.firebaseDb) {
            AppState.loadClubRegistry().then(() => {
                renderClubOptions();
            });
        }
    }

    if (registerNewClubBtn) {
        registerNewClubBtn.addEventListener('click', () => {
            const name = (newClubNameInput.value || '').trim();
            if (!name) {
                alert(t('alert.enter_club_name'));
                return;
            }
            const _clubNameKey = name.trim().toLowerCase();
            let newClubId = Object.entries(AppState.clubRegistry || {}).find(([, c]) => (c.name || '').trim().toLowerCase() === _clubNameKey)?.[0];
            if (!newClubId) {
                newClubId = 'club_' + Date.now();
                AppState.addOrUpdateClub(newClubId, name, 0);
            }
            const previousClub = { id: AppState.clubId, name: AppState.clubName };
            AppState.clubName = name;
            AppState.clubId = newClubId;
            AppState.clearClubData(previousClub);
            AppState.syncBudgetFromClub(name);
            AppState.save();
            newClubNameInput.value = '';
            newClubInputRow.classList.add('hidden');

            const finish = () => {
                renderClubOptions();
                setSettingsFormValues(AppState.rules);
            if (typeof setAdminRulesFormValues === 'function') setAdminRulesFormValues(AppState.rules);
            };
            if (AppState.firebaseDb) {
                AppState.loadClubRegistry().then(finish);
            } else {
                finish();
            }
        });
    }

    // 관리자 자부담 구간/비율 변경 시 전체 유저 실시간 반영
    window._onGlobalSettingsUpdate = () => {
        if (typeof setSettingsFormValues === 'function') setSettingsFormValues(AppState.rules);
        if (typeof setAdminRulesFormValues === 'function') setAdminRulesFormValues(AppState.rules);
        AppState.render();
    };
    AppState.loadGlobalSettings();

    // 수정 완료는 우측 하단 정산 완료 버튼(#send-email-btn)이 수정 모드 시 "수정 완료"로 전환되어 일괄 처리함 (v1.7.56)

    // 수정 모드 취소 버튼
    const editModeCancelBtn = document.getElementById('edit-mode-cancel-btn');
    if (editModeCancelBtn) {
        editModeCancelBtn.addEventListener('click', () => {
            AppState.cancelEditMode();
            resetSettlementSession();
        });
    }

    // Set form input fields default values
    const memberInput = document.getElementById('member-count-input');
    const nonMemberInput = document.getElementById('non-member-count-input');
    const prizeInput = document.getElementById('prev-prize-input');

    memberInput.value = AppState.memberCount;
    if (nonMemberInput) {
        nonMemberInput.value = AppState.nonMemberCount || 0;
        nonMemberInput.addEventListener('input', () => {
            AppState.nonMemberCount = Math.max(0, parseInt(nonMemberInput.value, 10) || 0);
        });
        nonMemberInput.addEventListener('change', () => {
            AppState.nonMemberCount = Math.max(0, parseInt(nonMemberInput.value, 10) || 0);
            nonMemberInput.value = AppState.nonMemberCount;
            AppState.save();
        });
    }
    prizeInput.value = formatAmount(AppState.previousPrizeTotal);

    // 비고 (특이사항) 드롭다운 + 새 항목 추가
    (function initEventNoteControls() {
        const noteSelect = document.getElementById('event-note-select');
        const newRow = document.getElementById('new-note-input-row');
        const newInput = document.getElementById('new-note-input');
        const addBtn = document.getElementById('add-new-note-btn');
        const cancelBtn = document.getElementById('cancel-new-note-btn');
        if (!noteSelect) return;

        const DEFAULT_NOTES = ['온라인', '가족 행사'];

        const renderNoteOptions = () => {
            const seen = new Set(DEFAULT_NOTES);
            const extras = [];
            (AppState.customNoteOptions || []).forEach(n => {
                const v = String(n || '').trim();
                if (v && !seen.has(v)) {
                    seen.add(v);
                    extras.push(v);
                }
            });
            const currentVal = String(AppState.eventNote || '').trim();
            if (currentVal && !seen.has(currentVal)) {
                seen.add(currentVal);
                extras.push(currentVal);
            }
            const allOptions = [...DEFAULT_NOTES, ...extras];
            noteSelect.innerHTML = `<option value="">선택 안 함 (일반 행사)</option>` +
                allOptions.map(n => `<option value="${AppState.escapeHtml(n)}">${AppState.escapeHtml(n)}</option>`).join('') +
                `<option value="__new__">+ 새 비고 항목 추가</option>`;
            noteSelect.value = currentVal;
        };
        window._renderEventNoteOptions = renderNoteOptions;
        renderNoteOptions();

        const closeNewNote = () => {
            if (newInput) newInput.value = '';
            if (newRow) newRow.classList.add('hidden');
            noteSelect.value = AppState.eventNote || '';
        };

        const submitNewNote = () => {
            const val = (newInput?.value || '').trim();
            if (!val) {
                alert('추가할 비고 항목명을 입력해 주세요.');
                return;
            }
            if (!['온라인', '가족 행사'].includes(val) && !(AppState.customNoteOptions || []).includes(val)) {
                AppState.customNoteOptions = [...(AppState.customNoteOptions || []), val];
                AppState.saveCustomNoteOptions();
            }
            AppState.eventNote = val;
            if (newInput) newInput.value = '';
            if (newRow) newRow.classList.add('hidden');
            renderNoteOptions();
            AppState.save();
        };

        noteSelect.addEventListener('change', () => {
            if (noteSelect.value === '__new__') {
                if (newRow) newRow.classList.remove('hidden');
                if (newInput) newInput.focus();
                return;
            }
            if (newRow) newRow.classList.add('hidden');
            AppState.eventNote = noteSelect.value || '';
            AppState.save();
        });

        if (addBtn) addBtn.addEventListener('click', submitNewNote);
        if (cancelBtn) cancelBtn.addEventListener('click', closeNewNote);
        if (newInput) {
            newInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); submitNewNote(); }
                if (e.key === 'Escape') closeNewNote();
            });
        }
    })();

    // 금액 입력란 1000단위 콤마(,) 자동 적용
    ['expense-amount-input', 'expense-corporate-amount-input',
     'expense-personal-amount-input', 'result-total-self-pay-input',
     'admin-setting-limit1', 'admin-setting-limit2', 'admin-setting-limit3', 'admin-setting-deduction4', 'admin-setting-prize-limit',
     'club-total-budget-input', 'club-budget-form-input'].forEach(id => {
        setupCurrencyInput(document.getElementById(id));
    });

    // Settings panel: init email and save-to-device fields
    const reportEmailInput = document.getElementById('setting-report-email');
    const saveDeviceCheck = document.getElementById('setting-save-device-check');

    // Set settings form input values
    const setSettingsFormValues = () => {
        const emailEl = document.getElementById('setting-report-email');
        const checkEl = document.getElementById('setting-save-device-check');
        if (emailEl) emailEl.value = AppState.reportEmail || '';
        if (checkEl) checkEl.checked = AppState.saveExcelToDevice !== false;
    };
    setSettingsFormValues();

    // Initial Datalist rendering
    AppState.updateDatalist();

    // 관리자 계정·권한·작업 로그·피드백 관리 UI는 js/admin-users-audit.js 로 분리됨 (v1.7.67)
    const {
        renderAuditLogList,
        loadAuditLogs,
        openAuditLogModal,
        closeAuditLogModal,
        getRoleBadgeHtml,
        changeAdminUserRole,
        editAdminUser,
        deleteAdminUser,
        renderFeedbackList
    } = window.__installAdminUsersAudit({
        get firebaseDb() { return firebaseDb; },
        renderAdminDashboard: (...args) => typeof renderAdminDashboard === 'function' && renderAdminDashboard(...args),
        setSettingsFormValues: (...args) => typeof setSettingsFormValues === 'function' && setSettingsFormValues(...args),
        syncHeaderAdminButton: (...args) => typeof syncHeaderAdminButton === 'function' && syncHeaderAdminButton(...args)
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const modal = document.getElementById('audit-log-modal');
            if (modal && !modal.classList.contains('hidden')) {
                closeAuditLogModal();
            }
            const pptModal = document.getElementById('year-end-ppt-modal');
            if (pptModal && !pptModal.classList.contains('hidden')) {
                closeYearEndPptModal();
            }
        }
    });

    // 연간 결산 PPT · 중간 결산 모달/엑셀은 js/export-reports.js 로 분리됨 (v1.7.49)
    window.__installExportReports({
        get lastHistoryList() { return lastHistoryList; },
        set lastHistoryList(v) { lastHistoryList = v; }
    });

    // ── 전사원 명부 회원별 클럽 참석 내역 호버 툴팁 & 모달 ──────────────────────────
    function getDirMemberBreakdownForQueryYear(memberEmpId) {
        const realCurrentYear = new Date().getFullYear();
        const activeQueryYear = (typeof _selectedQueryYear !== 'undefined' && _selectedQueryYear)
            ? String(_selectedQueryYear)
            : String(realCurrentYear);
        const empIdStr = String(memberEmpId || '').trim();
        const clubCounts = new Map();
        const yearMap = AppState._empClubBreakdownByYear || {};

        const mergeYearBucket = (bucket) => {
            if (!bucket || !empIdStr || !bucket[empIdStr]) return;
            Object.entries(bucket[empIdStr]).forEach(([clubName, dates]) => {
                if (!clubCounts.has(clubName)) clubCounts.set(clubName, []);
                clubCounts.get(clubName).push(...dates);
            });
        };

        if (activeQueryYear === 'ALL') {
            Object.values(yearMap).forEach(mergeYearBucket);
        } else {
            mergeYearBucket(yearMap[activeQueryYear]);
        }

        const clubList = Array.from(clubCounts.entries())
            .map(([clubName, dates]) => ({
                clubName,
                count: dates.length,
                dates: dates.filter(Boolean).sort((a, b) => b.localeCompare(a))
            }))
            .sort((a, b) => b.count - a.count || a.clubName.localeCompare(b.clubName, 'ko'));
        const totalMatched = clubList.reduce((s, c) => s + c.count, 0);
        const yearLabel = activeQueryYear === 'ALL' ? '전체 연도' : `${activeQueryYear}년`;
        return { activeQueryYear, yearLabel, totalMatched, clubList };
    }

    function showDirMemberHoverTooltip(anchorEl, memberName, memberEmpId, cachedCount = 0) {
        const tip = document.getElementById('dir-member-hover-tooltip');
        if (!tip || !anchorEl) return;
        const { yearLabel, totalMatched, clubList } = getDirMemberBreakdownForQueryYear(memberEmpId);
        const colorMap = (typeof getClubColorMap === 'function') ? getClubColorMap() : {};
        const headerHtml = `<div style="font-weight:800; font-size:0.84rem; margin-bottom:0.35rem; color:var(--text-primary); border-bottom:1px solid var(--card-border); padding-bottom:0.3rem;">🏅 ${AppState.escapeHtml(memberName)}${memberEmpId ? ` (${AppState.escapeHtml(memberEmpId)})` : ''} · ${yearLabel}</div>`;
        let bodyHtml = '';
        if (clubList.length === 0) {
            bodyHtml = `<div style="color:var(--text-muted); font-size:0.78rem;">${yearLabel} 참석한 클럽 이력이 없습니다.</div>`;
        } else {
            bodyHtml = `<div style="font-size:0.74rem; color:var(--text-secondary); margin-bottom:0.35rem;">총 <b>${totalMatched}회</b> 참석 (${clubList.length}개 클럽)</div>` +
                clubList.map(c => {
                    const dotColor = colorMap[c.clubName] || '#8b5cf6';
                    return `<div style="display:flex; align-items:center; justify-content:space-between; gap:0.6rem; padding:0.15rem 0;">
                        <span style="display:inline-flex; align-items:center; gap:0.35rem; font-weight:600; color:var(--text-primary);">
                            <span style="width:7px; height:7px; border-radius:50%; background:${dotColor}; display:inline-block;"></span>
                            ${AppState.escapeHtml(c.clubName)}
                        </span>
                        <span class="dir-club-count-text">${c.count}회</span>
                    </div>`;
                }).join('');
        }
        tip.innerHTML = headerHtml + bodyHtml;
        tip.classList.remove('hidden');

        const rect = anchorEl.getBoundingClientRect();
        const tipRect = tip.getBoundingClientRect();
        let left = rect.left;
        let top = rect.bottom + 8;
        if (left + tipRect.width > window.innerWidth - 12) {
            left = Math.max(12, window.innerWidth - tipRect.width - 12);
        }
        if (top + tipRect.height > window.innerHeight - 12) {
            top = Math.max(12, rect.top - tipRect.height - 8);
        }
        tip.style.left = `${left}px`;
        tip.style.top = `${top}px`;
    }

    function hideDirMemberHoverTooltip() {
        document.getElementById('dir-member-hover-tooltip')?.classList.add('hidden');
    }
    window.showDirMemberHoverTooltip = showDirMemberHoverTooltip;
    window.hideDirMemberHoverTooltip = hideDirMemberHoverTooltip;

    async function openDirMemberClubHistoryModal(memberName, memberEmpId, cachedCount = 0) {
        const modal = document.getElementById('dir-club-history-modal');
        const titleEl = document.getElementById('dir-club-history-title');
        const summaryEl = document.getElementById('dir-club-history-summary');
        const listEl = document.getElementById('dir-club-history-list');
        if (!modal || !titleEl || !summaryEl || !listEl) return;

        const realCurrentYear = new Date().getFullYear();
        const activeQueryYear = (typeof _selectedQueryYear !== 'undefined' && _selectedQueryYear)
            ? String(_selectedQueryYear)
            : String(realCurrentYear);
        const isAll = activeQueryYear === 'ALL';
        const targetYear = isAll ? null : (Number(activeQueryYear) || realCurrentYear);
        const yearLabel = isAll ? '전체' : `${targetYear}년`;
        const empIdStr = String(memberEmpId || '').trim();
        titleEl.textContent = `${memberName}${empIdStr ? ` (${empIdStr})` : ''} — ${yearLabel} 참석 내역`;
        summaryEl.textContent = '클럽별 참석 내역을 불러오는 중입니다...';
        listEl.innerHTML = '';
        modal.classList.remove('hidden');

        let historyList = [];
        if (firebaseDb) {
            try {
                const [histSnap, delSnap] = await Promise.all([
                    firebaseDb.ref('globalHistory').once('value'),
                    firebaseDb.ref('deletedHistoryIds').once('value')
                ]);
                const delMap = delSnap.val() || {};
                historyList = Object.values(histSnap.val() || {}).filter(e => e && !delMap[String(e.id)]);
            } catch (e) {
                console.warn('회원별 클럽 참석 내역 조회 실패:', e);
            }
        }
        if (historyList.length === 0) {
            historyList = (lastHistoryList && lastHistoryList.length)
                ? lastHistoryList
                : (AppState.settlementHistory || []);
        }

        // 사번(employeeId) 일치 기준으로만 집계 (동명이인 오귀속 방지 불변량 준수)
        const seenIds = new Set();
        const clubCounts = new Map();
        let totalMatched = 0;

        historyList.forEach(entry => {
            if (!entry || !entry.id || seenIds.has(entry.id)) return;
            seenIds.add(entry.id);
            if (!isAll && getHistoryEntryYear(entry) !== targetYear) return;
            const attendees = Array.isArray(entry.attendees) ? entry.attendees : [];
            const matched = empIdStr
                ? attendees.some(a => a && a.employeeId && String(a.employeeId).trim() === empIdStr)
                : false;
            if (!matched) return;

            totalMatched++;
            const clubName = String(entry.clubName || '기본 클럽').trim() || '기본 클럽';
            if (!clubCounts.has(clubName)) clubCounts.set(clubName, []);
            const dStr = entry.settlementDate || (entry.date ? String(entry.date).slice(0, 10) : '');
            clubCounts.get(clubName).push(dStr);
        });

        const clubList = Array.from(clubCounts.entries())
            .map(([clubName, dates]) => ({
                clubName,
                count: dates.length,
                dates: dates.filter(Boolean).sort((a, b) => b.localeCompare(a))
            }))
            .sort((a, b) => b.count - a.count || a.clubName.localeCompare(b.clubName, 'ko'));

        const colorMap = (typeof getClubColorMap === 'function') ? getClubColorMap() : {};
        summaryEl.innerHTML = totalMatched > 0
            ? `<b>${yearLabel} 총 ${totalMatched}회</b> 참석 · <b>${clubList.length}개</b> 클럽`
            : `${yearLabel} 등록된 클럽 참석 기록이 없습니다.${cachedCount > 0 ? ` (명부 누적 ${cachedCount}회)` : ''}`;

        if (clubList.length === 0) {
            listEl.innerHTML = `<div style="padding:1.25rem; text-align:center; color:var(--text-muted); font-size:0.84rem; border:1px dashed var(--card-border); border-radius:10px;">참석한 클럽 이력이 없습니다.</div>`;
            return;
        }

        listEl.innerHTML = clubList.map(item => {
            const dotColor = colorMap[item.clubName] || '#8b5cf6';
            const dateBadges = item.dates.map(d =>
                `<span style="display:inline-block; padding:0.15rem 0.45rem; font-size:0.72rem; border-radius:5px; background:rgba(148,163,184,0.14); color:var(--text-secondary);">${AppState.escapeHtml(d)}</span>`
            ).join('');
            return `
                <div style="padding:0.7rem 0.85rem; border:1px solid var(--card-border); border-radius:10px; background:rgba(255,255,255,0.03);">
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem; margin-bottom:${item.dates.length ? '0.45rem' : '0'};">
                        <span style="display:inline-flex; align-items:center; gap:0.45rem; font-weight:700; font-size:0.9rem; color:var(--text-primary);">
                            <span style="width:9px; height:9px; border-radius:50%; background:${dotColor}; display:inline-block; flex-shrink:0;"></span>
                            ${AppState.escapeHtml(item.clubName)}
                        </span>
                        <span class="dir-club-count-text" style="font-size:0.88rem;">${item.count}회</span>
                    </div>
                    ${item.dates.length ? `<div style="display:flex; flex-wrap:wrap; gap:0.3rem;">${dateBadges}</div>` : ''}
                </div>
            `;
        }).join('');
    }
    window.openDirMemberClubHistoryModal = openDirMemberClubHistoryModal;

    function closeDirMemberClubHistoryModal() {
        document.getElementById('dir-club-history-modal')?.classList.add('hidden');
    }
    document.getElementById('close-dir-club-history-modal')?.addEventListener('click', closeDirMemberClubHistoryModal);
    document.getElementById('dismiss-dir-club-history-modal')?.addEventListener('click', closeDirMemberClubHistoryModal);
    document.getElementById('dir-club-history-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'dir-club-history-modal') closeDirMemberClubHistoryModal();
    });

    ['audit-log-month-filter', 'audit-log-action-filter', 'audit-log-type-filter', 'audit-log-search-input'].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.addEventListener(id === 'audit-log-search-input' ? 'input' : 'change', renderAuditLogList);
    });
    document.getElementById('audit-log-refresh-btn')?.addEventListener('click', () => loadAuditLogs({ reset: true }));
    document.getElementById('audit-log-clear-btn')?.addEventListener('click', () => {
        if (!AppState.hasAdminAccess || !firebaseDb) return;
        showConfirmModal(
            '저장된 전체 작업 로그를 모두 삭제하시겠습니까?\n(삭제 후 복구할 수 없습니다.)',
            async () => {
                try {
                    await firebaseDb.ref('auditLogs').remove();
                    auditLogEntries = [];
                    auditLogOldestKey = null;
                    auditLogHasMore = false;
                    renderAuditLogList();
                    const statusEl = document.getElementById('audit-log-load-status');
                    if (statusEl) statusEl.textContent = '모든 작업 로그가 삭제되었습니다.';
                    showAlertModal('작업 로그가 모두 삭제되었습니다.', '삭제 완료', '✅');
                } catch (e) {
                    console.error('로그 삭제 실패:', e);
                    showAlertModal('로그 삭제 실패: ' + (e.message || ''), '오류', '⚠️');
                }
            }
        );
    });
    document.getElementById('audit-log-load-more-btn')?.addEventListener('click', () => loadAuditLogs());
    document.getElementById('audit-log-reset-filter-btn')?.addEventListener('click', () => {
        const monthFilter = document.getElementById('audit-log-month-filter');
        const actionFilter = document.getElementById('audit-log-action-filter');
        const typeFilter = document.getElementById('audit-log-type-filter');
        const searchInput = document.getElementById('audit-log-search-input');
        if (monthFilter) monthFilter.value = '';
        if (actionFilter) actionFilter.value = '';
        if (typeFilter) typeFilter.value = '';
        if (searchInput) searchInput.value = '';
        renderAuditLogList();
    });

    // Tab navigation switching logic
    document.querySelectorAll('.tab-nav .tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-nav .tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));

            btn.classList.add('active');
            const tabId = btn.getAttribute('data-tab');
            document.getElementById(tabId).classList.remove('hidden');

            // 차트 탭을 직접 선택한 경우에만 진입 애니메이션을 1회 예약한다.
            // 데이터·테마 갱신에 따른 재렌더에서는 반복 재생하지 않아 화면 피로와 깜빡임을 줄인다.
            if (tabId === 'tab-charts' && typeof requestChartEntranceAnimation === 'function') {
                requestChartEntranceAnimation();
            }

            // 관리자 탭 전환 시: globalHistory 최신화 (대시보드·클럽이력·차트 공통)
            if ((tabId === 'tab-admin' || tabId === 'tab-club-history' || tabId === 'tab-charts') && typeof renderAdminDashboard === 'function') {
                renderAdminDashboard({ animateChartsOnLoad: tabId === 'tab-charts' });
            }
            // 비용 정산 탭 전환 시: 참석자 명단/명부 탭 등에서 추가/수정된 인원 및 정산 결과 즉시 재반영
            if (tabId === 'tab-settlement') {
                AppState.render();
            }
            // 이력 탭 전환 시: 동일 클럽의 전체 사용자 이력 로드
            if (tabId === 'tab-history') {
                AppState.loadClubHistory().then(() => AppState.render());
            }
            if (tabId === 'tab-audit-log') {
                loadAuditLogs({ reset: true });
            }
            // 차트 탭 전환 시: 숨겨진 상태에서 렌더링 불가 → 탭이 보인 후 재렌더
            if (tabId === 'tab-charts' && typeof renderAllCharts === 'function') {
                requestAnimationFrame(() => {
                    if (typeof renderClubFilters === 'function') renderClubFilters();
                    renderAllCharts(lastHistoryList || []);
                });
            }
            // v1.6.335: 와이드 데스크톱(≥1600px)에서는 차트/클럽별 정산이력 영역을 화면 상단에 맞춰
            // 차트 전체(또는 클럽 카드 4개 1줄)가 한 화면에 바로 보이도록 스크롤한다.
            if ((tabId === 'tab-charts' || tabId === 'tab-club-history')
                && typeof window.matchMedia === 'function'
                && window.matchMedia('(min-width: 1200px) and (min-height: 820px)').matches) {
                requestAnimationFrame(() => {
                    const target = tabId === 'tab-charts'
                        ? document.querySelector('#tab-charts .charts-dashboard-shell')
                        : document.querySelector('#tab-club-history > .card');
                    if (!target) return;
                    const top = target.getBoundingClientRect().top + window.scrollY - 12;
                    window.scrollTo({ top: Math.max(0, top), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
                });
            }
        });
    });

    // Attendee autocomplete — 커스텀 드롭다운 (동명이인 사번 선택 지원)
    const attendeeNameInput = document.getElementById('attendee-name-input');
    const attendeeIdInput = document.getElementById('attendee-id-input');
    const attendeeDropdown = document.getElementById('attendee-name-dropdown');

    function hideAttendeeDropdown() {
        if (attendeeDropdown) attendeeDropdown.classList.add('hidden');
    }

    // 동명이인 사번 선택 팝업
    function showEmpIdPickerPopup(name, entries, onSelect) {
        const existing = document.getElementById('emp-id-picker-popup');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'emp-id-picker-popup';
        overlay.className = 'emp-picker-overlay';

        const box = document.createElement('div');
        box.className = 'emp-picker-box';

        const title = document.createElement('p');
        title.className = 'emp-picker-title';
        title.textContent = `"${name}" 동명이인 — 사번을 선택하세요`;
        box.appendChild(title);

        entries.forEach(entry => {
            const recent = AppState.getRecentClubAttendance(entry.id);
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `emp-picker-btn ${recent ? 'is-recent' : ''}`;
            const recentBadge = recent
                ? `<span class="emp-picker-recent-badge">✅ 이 클럽 최근 참석 (${AppState.escapeHtml(recent.dateStr)})</span>`
                : '';
            btn.innerHTML = `<span class="emp-picker-name">${AppState.escapeHtml(entry.name)}</span><span class="emp-picker-id">EMP ID: ${AppState.escapeHtml(entry.id)}</span>${recentBadge}`;
            btn.addEventListener('click', () => { onSelect(entry); overlay.remove(); });
            box.appendChild(btn);
        });

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'emp-picker-cancel-btn';
        cancelBtn.textContent = '취소';
        cancelBtn.addEventListener('click', () => overlay.remove());
        box.appendChild(cancelBtn);

        overlay.appendChild(box);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
    }
    window.showEmpIdPickerPopup = showEmpIdPickerPopup;

    function showAttendeeDropdown(entries) {
        if (!attendeeDropdown) return;
        attendeeDropdown.innerHTML = '';
        entries.forEach(entry => {
            const item = document.createElement('div');
            item.className = 'attendee-dropdown-item';
            const hasDupe = entries.filter(e => e.name === entry.name).length > 1;
            if (hasDupe) {
                // 동명이인 항목 중 이 클럽 최근 참석 이력이 있는 사번을 강조
                const recent = AppState.getRecentClubAttendance(entry.id);
                item.textContent = `${entry.name} (사번: ${entry.id})`;
                if (recent) {
                    item.style.background = 'rgba(52,211,153,0.12)';
                    item.style.borderLeft = '3px solid rgb(52,211,153)';
                    item.title = `이 클럽 최근 참석: ${recent.dateStr}`;
                }
            } else {
                item.textContent = entry.name;
            }
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                attendeeNameInput.value = entry.name;
                attendeeIdInput.value = entry.id;
                hideAttendeeDropdown();
            });
            attendeeDropdown.appendChild(item);
        });
        attendeeDropdown.classList.remove('hidden');
    }

    attendeeNameInput.addEventListener('input', () => {
        AppState.clearAttendeeDuplicateHint();
        const query = attendeeNameInput.value.trim();
        if (!query) { hideAttendeeDropdown(); return; }

        const matches = AppState.getAllDirectoryMatches(query);
        if (matches.length === 0) { hideAttendeeDropdown(); return; }

        const exactMatches = matches.filter(m => m.name === query);
        if (exactMatches.length === 1) {
            // 단일 → 사번 자동 입력
            attendeeIdInput.value = exactMatches[0].id;
            hideAttendeeDropdown();
            return;
        }
        if (exactMatches.length > 1) {
            // 동명이인 → 팝업 선택
            hideAttendeeDropdown();
            showEmpIdPickerPopup(query, exactMatches, (entry) => {
                attendeeNameInput.value = entry.name;
                attendeeIdInput.value = entry.id;
            });
            return;
        }
        // 부분 일치 → 인라인 드롭다운 제안
        showAttendeeDropdown(matches.slice(0, 8));
    });

    attendeeNameInput.addEventListener('blur', () => {
        setTimeout(hideAttendeeDropdown, 150);
    });

    attendeeIdInput.addEventListener('input', () => AppState.clearAttendeeDuplicateHint());

    function showAttendeeError(msg) {
        const el = document.getElementById('attendee-error-msg');
        if (!el) return;
        el.textContent = msg;
        el.classList.remove('hidden');
        clearTimeout(el._timer);
        el._timer = setTimeout(() => el.classList.add('hidden'), 3500);
    }

    function trySubmitAttendee() {
        const name = attendeeNameInput.value.trim();
        const id = attendeeIdInput.value.trim();
        if (!name) { showAttendeeError('이름을 입력해 주세요.'); return; }
        if (!id) { showAttendeeError('사번(EMP ID)은 필수입니다.'); return; }

        AppState.addAttendee(name, id);
    }

    // Add Attendee Form submission
    const attendeeForm = document.getElementById('attendee-form');
    attendeeForm.addEventListener('submit', (e) => {
        e.preventDefault();
        trySubmitAttendee();
    });

    // Enter key on each input submits attendee form
    [attendeeNameInput, attendeeIdInput].forEach(input => {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                trySubmitAttendee();
            }
        });
    });

    // Cancel edit attendee listener
    const cancelEditAttendeeBtn = document.getElementById('cancel-edit-attendee-btn');
    if (cancelEditAttendeeBtn) {
        cancelEditAttendeeBtn.addEventListener('click', () => {
            AppState.cancelEditAttendee();
        });
    }

    // Add Directory database form handlers
    const dirForm = document.getElementById('dir-form');
    const dirNameInput = document.getElementById('dir-name-input');
    const dirIdInput = document.getElementById('dir-id-input');

    function showDirError(msg) {
        const el = document.getElementById('dir-error-msg');
        if (!el) return;
        el.textContent = msg;
        el.classList.remove('hidden');
        clearTimeout(el._timer);
        el._timer = setTimeout(() => el.classList.add('hidden'), 3500);
    }

    const dirExistingIdHint = document.getElementById('dir-existing-id-hint');

    function getExistingIds(name) {
        const entry = AppState.directory[name];
        if (!entry) return [];
        if (typeof entry === 'object' && Array.isArray(entry.ids)) return entry.ids.map(String);
        return [String(typeof entry === 'object' ? entry.id : entry)];
    }

    function updateDirNameHint() {
        const name = dirNameInput.value.trim();
        const currentId = dirIdInput.value.trim();
        const existingIds = name ? getExistingIds(name) : [];

        if (existingIds.length === 1) {
            // 단일 → EMP ID 자동 입력
            if (!currentId) dirIdInput.value = existingIds[0];
            dirExistingIdHint.textContent = `등록된 EMP ID: ${existingIds[0]}`;
            dirExistingIdHint.classList.remove('hidden');
        } else if (existingIds.length > 1) {
            // 동명이인 → 팝업으로 사번 선택 (EMP ID 빈 경우)
            dirExistingIdHint.textContent = `동명이인 ${existingIds.length}명 (EMP ID: ${existingIds.join(', ')})`;
            dirExistingIdHint.classList.remove('hidden');
            if (!currentId) {
                showEmpIdPickerPopup(name, existingIds.map(id => ({ name, id })), (entry) => {
                    dirIdInput.value = entry.id;
                    updateDirNameHint();
                });
            }
        } else {
            dirExistingIdHint.classList.add('hidden');
        }
    }

    function trySubmitDir() {
        const name = dirNameInput.value.trim();
        const id = dirIdInput.value.trim();
        if (!name || !id) return;

        if (AppState.editingDirName === null) {
            const existingIds = getExistingIds(name);
            if (existingIds.includes(id)) {
                showDirError(`이미 동일한 이름과 EMP ID로 등록되어 있습니다: ${name} (${id})`);
                return;
            }
        }
        AppState.addDirectoryEntry(name, id);
        dirExistingIdHint.classList.add('hidden');
    }


    if (dirForm) {
        dirForm.addEventListener('submit', (e) => {
            e.preventDefault();
            trySubmitDir();
        });

        [dirNameInput, dirIdInput].forEach(input => {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    trySubmitDir();
                }
            });
        });

        dirNameInput.addEventListener('input', updateDirNameHint);
        dirIdInput.addEventListener('input', updateDirNameHint);
    }

    const cancelEditDirBtn = document.getElementById('cancel-edit-dir-btn');
    if (cancelEditDirBtn) {
        cancelEditDirBtn.addEventListener('click', () => {
            AppState.cancelEditDirectory();
        });
    }

    // 전사원 명부 실시간 검색 리스너
    const dirSearchInput = document.getElementById('dir-search-input');
    const dirSearchClearBtn = document.getElementById('dir-search-clear-btn');
    if (dirSearchInput) {
        dirSearchInput.addEventListener('input', (e) => {
            AppState.filterDirectoryList(e.target.value);
        });
        dirSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                dirSearchInput.value = '';
                AppState.filterDirectoryList('');
            }
        });
    }
    if (dirSearchClearBtn) {
        dirSearchClearBtn.addEventListener('click', () => {
            if (dirSearchInput) {
                dirSearchInput.value = '';
                dirSearchInput.focus();
            }
            AppState.filterDirectoryList('');
        });
    }

    // Clear attendees handler
    document.getElementById('clear-attendees-btn').addEventListener('click', () => {
        if (AppState.attendees.length > 0) {
            showConfirmModal(t('confirm.clear_all_attendees'), () => {
                AppState.clearAttendees();
            }, null, '전체 비우기 확인', '🗑️');
        }
    });

    // 종전 참석자 불러오기 (버튼 클릭 시 가장 최근 정산 참석자 명단을 현재 명단에 즉시 추가)
    (function initPrevAttendeesLoader() {
        const openBtn = document.getElementById('load-prev-attendees-btn');
        if (!openBtn) return;

        openBtn.addEventListener('click', async () => {
            if (!AppState.clubName && !AppState.clubId) {
                alert('상단에서 먼저 클럽을 선택해 주세요.');
                return;
            }
            const origText = openBtn.textContent;
            openBtn.disabled = true;
            openBtn.textContent = '⏳ 불러오는 중...';

            try {
                if (AppState.firebaseDb && (!AppState.clubHistory || AppState.clubHistory.length === 0)) {
                    await AppState.loadClubHistory();
                }

                const combined = [...(AppState.clubHistory || []), ...(AppState.settlementHistory || [])];
                const byId = new Map();
                combined.forEach(entry => {
                    if (!entry || !Array.isArray(entry.attendees) || entry.attendees.length === 0) return;
                    if (!historyMatchesClub(entry, AppState.clubId, AppState.clubName)) return;
                    const key = String(entry.id || `${entry.settlementDate || entry.date}_${entry.attendees.length}`);
                    if (!byId.has(key)) byId.set(key, entry);
                });

                const sortedEntries = Array.from(byId.values()).sort((a, b) => {
                    const da = String(a.settlementDate || a.date || '');
                    const db = String(b.settlementDate || b.date || '');
                    if (db !== da) return db.localeCompare(da);
                    return (Number(b.id) || 0) - (Number(a.id) || 0);
                });

                if (sortedEntries.length === 0) {
                    alert(`'${AppState.clubName || '선택한 클럽'}'의 종전 정산 참석자 기록이 없습니다.`);
                    return;
                }

                const latestEntry = sortedEntries[0];
                const existingIds = new Set((AppState.attendees || []).map(a => String(a.employeeId || '').trim()).filter(Boolean));
                const existingNames = new Set((AppState.attendees || []).map(a => String(a.name || '').trim()).filter(Boolean));
                const baseId = Date.now();
                let addedCount = 0;

                latestEntry.attendees.forEach((att, seq) => {
                    if (!att || !att.name) return;
                    const name = String(att.name).trim();
                    const empId = String(att.employeeId || '').trim();
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
                    alert('종전 참석자가 이미 모두 현재 명단에 포함되어 있습니다.');
                    return;
                }

                AppState.memberCount = AppState.attendees.length;
                AppState.save();
                AppState.render();
            } finally {
                openBtn.disabled = false;
                openBtn.textContent = origText;
            }
        });
    })();

    // 이메일 보고서 생성·발송 및 파일 공유/다운로드 모듈은 js/email-report.js 로 분리됨 (v1.7.65)
    if (typeof window.__installEmailReport === 'function') {
        window.__installEmailReport(AppState);
    }

    // 정산 이력 유틸·수정·확정·중복체크 엔진은 js/settlement-history.js 로 분리됨 (v1.7.64)
    if (typeof window.__installSettlementHistory === 'function') {
        window.__installSettlementHistory(AppState);
    }

    // 클럽별 정회원 관리 UI/로직은 js/regular-members.js 로 분리됨 (v1.7.63)
    if (typeof window.__installRegularMembers === 'function') {
        window.__installRegularMembers({
            get lastHistoryList() { return lastHistoryList; },
            set lastHistoryList(v) { lastHistoryList = v; },
            extractValidGlobalHistory,
            compareHistoryEntriesNewestFirst,
            historyMatchesClub
        });
    }

    // Toggle settings panel handler
    document.getElementById('toggle-settings-btn').addEventListener('click', () => {
        const panel = document.getElementById('settings-panel');
        panel.classList.toggle('hidden');
        if (!panel.classList.contains('hidden')) {
            const emailEl = document.getElementById('setting-report-email');
            const checkEl = document.getElementById('setting-save-device-check');
            if (emailEl) emailEl.value = AppState.reportEmail || '';
            if (checkEl) checkEl.checked = AppState.saveExcelToDevice !== false;
        }
    });

    // Save settings handler
    document.getElementById('save-settings-btn').addEventListener('click', () => {
        const emailEl = document.getElementById('setting-report-email');
        const checkEl = document.getElementById('setting-save-device-check');
        if (emailEl) {
            AppState.reportEmail = emailEl.value.trim();
            if (AppState.isLoggedIn && AppState.firebaseDb && AppState.currentPin) {
                AppState.firebaseDb.ref(`users/${AppState.currentPin}/email`).set(AppState.reportEmail).catch(() => {});
            }
        }
        if (checkEl) AppState.saveExcelToDevice = checkEl.checked;
        AppState.save();
        AppState.render();
        alert('정산 및 발송 설정이 저장되었습니다.');

        // Hide panel after saving
        document.getElementById('settings-panel').classList.add('hidden');
    });

    // Admin: 연도별 정산 구간·비율 설정 UI는 js/rules-manager.js 로 분리됨 (v1.7.70)
    const {
        setAdminRulesFormValues
    } = window.__installRulesUI({
        getSelectedQueryYear: () => _selectedQueryYear
    });

    // Admin: Google Apps Script 첨부 메일 웹훅 설정
    const emailWebhookInput = document.getElementById('admin-email-webhook-input');
    const saveEmailWebhookBtn = document.getElementById('save-email-webhook-btn');
    const emailWebhookStatus = document.getElementById('admin-email-webhook-status');
    const copyGasScriptBtn = document.getElementById('copy-gas-script-btn');
    const testEmailWebhookBtn = document.getElementById('test-email-webhook-btn');
    if (emailWebhookInput && AppState.emailWebhookUrl) {
        emailWebhookInput.value = AppState.emailWebhookUrl;
    }
    if (saveEmailWebhookBtn && emailWebhookInput) {
        saveEmailWebhookBtn.addEventListener('click', async () => {
            const url = emailWebhookInput.value.trim();
            if (url && !/^https:\/\/script\.google\.com\/macros\//i.test(url)) {
                alert('올바른 Google Apps Script 웹 앱 URL(https://script.google.com/macros/...)을 입력해 주세요.');
                return;
            }
            const ok = await AppState.saveEmailWebhookUrl(url);
            if (ok && emailWebhookStatus) {
                emailWebhookStatus.style.display = 'block';
                setTimeout(() => { emailWebhookStatus.style.display = 'none'; }, 2500);
            } else if (!ok) {
                alert('웹 앱 URL 저장에 실패했습니다. 네트워크 연결을 확인해 주세요.');
            }
        });
    }
    if (copyGasScriptBtn) {
        copyGasScriptBtn.addEventListener('click', async () => {
            try {
                const res = await fetch('./google_apps_script_email.gs?_=' + Date.now());
                const code = await res.text();
                await navigator.clipboard.writeText(code);
                alert('Google Apps Script 코드가 클립보드에 복사되었습니다.\nscript.google.com 새 프로젝트에 붙여넣고 웹 앱으로 배포해 주세요.');
            } catch (err) {
                alert('코드 복사에 실패했습니다. 저장소의 google_apps_script_email.gs 파일을 확인해 주세요.');
            }
        });
    }
    if (testEmailWebhookBtn && emailWebhookInput) {
        testEmailWebhookBtn.addEventListener('click', async () => {
            const url = emailWebhookInput.value.trim() || AppState.emailWebhookUrl;
            if (!url || !/^https:\/\/script\.google\.com\/macros\//i.test(url)) {
                alert('먼저 올바른 Google Apps Script 웹 앱 URL을 입력해 주세요.');
                return;
            }
            const testTo = (AppState.reportEmail || '').trim() || prompt('테스트 메일을 받을 이메일 주소를 입력해 주세요:', '');
            if (!testTo || !testTo.trim()) return;
            testEmailWebhookBtn.disabled = true;
            const prevText = testEmailWebhookBtn.textContent;
            testEmailWebhookBtn.textContent = '⏳ 발송 중...';
            try {
                AppState.emailWebhookUrl = url;
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify({
                        to: testTo.trim(),
                        subject: '[3M 클럽 비용 정산기] 첨부 메일 연동 테스트',
                        body: 'Google Apps Script 첨부 메일 연동이 정상적으로 완료되었습니다.',
                        senderName: '3M 클럽 비용 정산기',
                        attachments: []
                    })
                });
                const data = await res.json().catch(() => ({}));
                if (res.ok && data.success) {
                    alert(`✅ 테스트 메일이 [${testTo.trim()}]로 발송되었습니다!`);
                } else {
                    alert('❌ 연동 테스트 실패: ' + (data.error || `HTTP ${res.status}`));
                }
            } catch (err) {
                alert('❌ 연동 테스트 중 오류가 발생했습니다: ' + (err.message || err));
            } finally {
                testEmailWebhookBtn.disabled = false;
                testEmailWebhookBtn.textContent = prevText;
            }
        });
    }

    // 상품비 누적액 표시 갱신 (현재 세션 PRIZE 항목 합계 → prizeInput 반영)
    // previousPrizeTotal은 클럽 레지스트리(prizeUsed)에서 관리하므로 여기서 건드리지 않음
    function syncPrizeTotalFromItems() {
        const sessionPrize = (AppState.expenseItems || [])
            .filter(item => item.category === ExpenseCategory.PRIZE)
            .reduce((sum, item) => sum + (item.amount || 0), 0);
        // prizeInput: 현재 세션 상품비 + 확정 누적 합계 표시
        const totalDisplay = (AppState.previousPrizeTotal || 0) + sessionPrize;
        if (prizeInput) prizeInput.value = totalDisplay > 0 ? formatAmount(totalDisplay) : '0';
        AppState.render();
    }
    window._syncPrizeTotalFromItems = syncPrizeTotalFromItems;
    syncPrizeTotalFromItems();

    // Form submission listener
    const form = document.getElementById('expense-form');
    const descInput = document.getElementById('expense-desc-input');
    const amountInput = document.getElementById('expense-amount-input');
    const catSelect = document.getElementById('expense-category-select');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (!AppState.hasSelectedClub()) {
            alert('먼저 상단에서 정산할 클럽을 선택해 주세요.');
            const clubSel = document.getElementById('club-name-select');
            if (clubSel) {
                clubSel.scrollIntoView({ behavior: 'smooth', block: 'center' });
                clubSel.focus();
            }
            return;
        }

        const description = descInput.value.trim();
        const amount = parseAmount(amountInput.value);
        const category = catSelect.value;
        const corpChecked = document.getElementById('expense-corp-check').checked;
        const personalChecked = document.getElementById('expense-personal-check').checked;
        const corporateAmount = parseAmount(document.getElementById('expense-corporate-amount-input').value);

        if (description && !isNaN(amount) && amount > 0) {
            // ── 예산 한도 확인: 클럽별 + 전체 총 예산 (EVENT / FACILITY / PRIZE 공통) ──
            // v1.6.217+: 항목별 법인/개인카드 실제 배분이 자부담 기준이 되므로(v1.6.215),
            // "이 항목 전체 금액이 지원되면"이라는 정책 추정치(_newSupport)가 아니라
            // "지금 실제로 법인카드에 배정하려는 금액(_requestedCorp)"만 예산과 비교한다.
            // 법인카드 0원(전액 개인카드=자부담)으로 두면 예산이 소진돼 있어도 항목 추가는 항상 허용된다.
            const _editingId  = AppState.editingItemId || null;
            const _existItems = (AppState.expenseItems || []).filter(i => i.id !== _editingId);
            const _requestedCorp = corpChecked ? Math.min(corporateAmount || 0, amount) : 0;

            // ⓪ 행사비: 인당 법인카드 지원액이 "인원수 대비 정책 계산값"을 초과하면 확인
            // (예산이 충분해도 대상 — 클럽 예산 초과 여부는 별개인 ①/② 에서 확인)
            // ⓐ 정책 계산값 초과~85,000원 이내 = 이 자리에서 이사진 승인 여부 팝업(사용자가 답변)
            // ⓑ 85,000원 자체 초과 = 극히 예외적인 케이스라 사용자가 팝업으로 결정하지 않고,
            //    관리자가 "클럽 관리" 탭에서 그 클럽에 한해 미리 승인해둔 경우에만 자동 허용(v1.6.220)
            if (category === ExpenseCategory.EVENT && !_corpOverLimitApproved) {
                const _memberCount = AppState.memberCount || 0;
                const _rules = AppState.rules || DefaultRules;
                const _perPersonCap = _rules.deduction4 || 85000;
                if (_memberCount > 0 && _requestedCorp > 0) {
                    const _existingEventItems = _existItems.filter(i => i.category === ExpenseCategory.EVENT);
                    const _existingCorpSum = _existingEventItems.reduce((s, i) => s + (i.corporateAmount || 0), 0);
                    const _requestedPerPersonCorp = (_existingCorpSum + _requestedCorp) / _memberCount;

                    // 정책(구간표) 계산상 인원수 대비 지원 가능한 금액 — 실제 행사비 기준
                    const _eventItemsForCheck = [..._existingEventItems, { category: ExpenseCategory.EVENT, amount }];
                    const _eventResult = SettlementCalculator.calculate(_memberCount, _eventItemsForCheck, 0, _rules);
                    const _bracketPerPersonSupport = _eventResult.finalSupportAmount / _memberCount;

                    const _revertToBracket = () => {
                        const _reverted = Math.max(0, Math.min(amount, Math.round(_bracketPerPersonSupport * _memberCount) - _existingCorpSum));
                        const _corpInput = document.getElementById('expense-corporate-amount-input');
                        if (_corpInput) _corpInput.value = formatAmount(_reverted);
                        if (typeof updateCardTypeUI === 'function') updateCardTypeUI();
                    };

                    if (_requestedPerPersonCorp > _perPersonCap) {
                        // ⓑ 인당 85,000원 정책 최대치 자체를 초과 — 극히 예외적인 경우라 사용자가 그 자리에서
                        // 팝업으로 직접 승인하지 않고, 관리자가 클럽 관리에서 미리 승인해둔 클럽만 허용한다.
                        const _clubEntry = (AppState.clubId && AppState.clubRegistry[AppState.clubId])
                            ? AppState.clubRegistry[AppState.clubId]
                            : (AppState.clubName ? Object.values(AppState.clubRegistry || {}).find(c => c.name === AppState.clubName) : null);
                        const _hasOverLimitApproval = Boolean((_clubEntry && _clubEntry.allowOverLimitSupport) || (AppState.editingHistoryId && AppState._editingOverLimitApproved));
                        if (_hasOverLimitApproval) {
                            // 관리자 승인된 클럽(또는 기존 승인 이력 수정 중) → 클럽 잔여 예산 내에서 사용 가능한 최대 금액으로 재계산 후 진행
                            const _cb = AppState.getClubBudget ? AppState.getClubBudget() : 0;
                            const _cu = AppState.getClubUsedBudget ? AppState.getClubUsedBudget() : 0;
                            const _already = _existItems.reduce((s, i) => s + (i.corporateAmount || 0), 0);
                            const _realRemaining = _cb > 0 ? Math.max(0, _cb - _cu - _already) : Infinity;
                            const _maxUsable = Math.min(amount, _realRemaining === Infinity ? amount : _realRemaining);
                            const _corpInput = document.getElementById('expense-corporate-amount-input');
                            if (_corpInput) _corpInput.value = formatAmount(_maxUsable);
                            if (typeof updateCardTypeUI === 'function') updateCardTypeUI();
                            // 계속 진행 (재확인 없이 아래 예산 검증으로 이어짐)
                        } else {
                            showPrizeModal(
                                `인당 정책 최대 지원금(${_perPersonCap.toLocaleString()}원)을 초과하는 금액입니다.\n` +
                                `이 클럽은 관리자로부터 "85,000원 초과 지원" 승인을 받지 않았습니다.\n` +
                                `필요하면 관리자에게 클럽 관리 탭에서 승인해 달라고 요청해 주세요.`,
                                () => _revertToBracket(),
                                'block'
                            );
                            return;
                        }
                    } else if (_requestedPerPersonCorp > _bracketPerPersonSupport) {
                        // ⓐ 주의: 정책 계산값은 넘지만 85,000원 이내
                        showCorpOverLimitModal(
                            `참석 인원 대비 정책상 지원 가능한 금액(<b>${Math.round(_bracketPerPersonSupport).toLocaleString()}원/인</b>)을 초과합니다.<br>` +
                            `이사진 승인 하에 인당 최대 <b>${_perPersonCap.toLocaleString()}원</b>까지 지원받기로 하였나요?`,
                            () => { _corpOverLimitApproved = true; },
                            () => { _corpOverLimitApproved = false; _revertToBracket(); }
                        );
                        return;
                    }
                }
            }

            // ⓪-2 시설·장비: 법인카드 지정액이 인당 한도(facilityLimit × 인원수)를 초과하면 차단 (v1.6.233)
            // 단, 관리자가 [클럽 관리 > 시설 전액] 1회 승인을 활성화한 클럽은 잔여 예산 전액까지 허용 (v1.7.44)
            const _facilityClubEntry = (AppState.clubId && AppState.clubRegistry[AppState.clubId])
                ? AppState.clubRegistry[AppState.clubId]
                : (AppState.clubName ? Object.values(AppState.clubRegistry || {}).find(c => c.name === AppState.clubName) : null);
            const _facilityFullApproved = Boolean((_facilityClubEntry && _facilityClubEntry.allowFacilityFullBudget) || (AppState.editingHistoryId && AppState._editingFacilityFullApproved));
            if (category === ExpenseCategory.FACILITY && _requestedCorp > 0 && !_facilityFullApproved) {
                const _fMemberCount = AppState.memberCount || 0;
                if (_fMemberCount > 0) {
                    const _fLimit = (AppState.rules || DefaultRules).facilityLimit || 85000;
                    const _fCapTotal = _fMemberCount * _fLimit;
                    const _fExistingCorp = _existItems
                        .filter(i => i.category === ExpenseCategory.FACILITY)
                        .reduce((s, i) => s + (i.corporateAmount || 0), 0);
                    if (_fExistingCorp + _requestedCorp > _fCapTotal) {
                        const _fCapLeft = Math.max(0, _fCapTotal - _fExistingCorp);
                        showPrizeModal(
                            `시설·장비 이용료의 법인카드 사용은 인당 ${_fLimit.toLocaleString()}원을 초과할 수 없습니다.\n` +
                            `(인당 ${_fLimit.toLocaleString()}원 × ${_fMemberCount}명 = 최대 ${_fCapTotal.toLocaleString()}원)\n` +
                            `이 항목에 사용 가능한 법인카드: ${_fCapLeft.toLocaleString()}원\n` +
                            `확인을 누르면 법인카드 금액이 한도로 조정되고, 초과분은 개인카드(자부담)로 처리됩니다.`,
                            () => {
                                const _corpInput = document.getElementById('expense-corporate-amount-input');
                                if (_corpInput) _corpInput.value = formatAmount(Math.min(amount, _fCapLeft));
                                if (typeof updateCardTypeUI === 'function') updateCardTypeUI();
                            },
                            'block'
                        );
                        return;
                    }
                }
            }

            // ① 클럽 배정 예산 초과 확인 (getClubUsedBudget()이 수정 모드일 때 이 이력 자신의 몫을 이미 제외함)
            const _clubBudget = AppState.getClubBudget ? AppState.getClubBudget() : 0;
            if (_clubBudget > 0 && _requestedCorp > 0) {
                const _clubUsed = AppState.getClubUsedBudget ? AppState.getClubUsedBudget() : 0;
                // 이번 세션에서 다른 항목에 이미 실제로 배정된 법인카드 금액도 함께 차감
                const _alreadyCorpAssigned = _existItems.reduce((s, i) => s + (i.corporateAmount || 0), 0);
                const _budgetLeft = Math.max(0, _clubBudget - _clubUsed - _alreadyCorpAssigned);

                if (_requestedCorp > _budgetLeft) {
                    showPrizeModal(
                        `법인카드로 지정한 금액이 클럽 잔여 예산을 초과합니다.\n` +
                        `실제 남은 예산: ${_budgetLeft.toLocaleString()}원\n` +
                        `법인카드 지정액: ${_requestedCorp.toLocaleString()}원\n` +
                        `법인카드 금액을 줄이세요 (초과분은 개인카드=자부담으로 처리하면 항목 추가가 가능합니다).`,
                        null, 'block'
                    );
                    return;
                }
            }

            // ② 전체 총 예산 초과 확인
            const _totalBudget = AppState.clubTotalBudget || 0;
            if (_totalBudget > 0 && _requestedCorp > 0) {
                let _allUsed = Object.values(AppState.clubRegistry || {})
                    .reduce((sum, c) => sum + (c.usedBudget || 0), 0);
                // 이력 수정 모드: 이 이력이 원래 기여했던 지원금은 전체 사용액에서도 동일하게 제외
                if (AppState.editingHistoryId) {
                    _allUsed = Math.max(0, _allUsed - (AppState._editingOriginalSupport || 0));
                }
                const _allPriorUsed = Object.values(AppState.clubRegistry || {})
                    .reduce((sum, c) => sum + (c.priorUsed || 0), 0);
                const _totalUsed = _allPriorUsed + _allUsed;
                const _totalLeft = Math.max(0, _totalBudget - _totalUsed);

                if (_requestedCorp > _totalLeft) {
                    showPrizeModal(
                        `법인카드로 지정한 금액이 전체 클럽 총 잔여 예산을 초과합니다.\n` +
                        `총 잔여 예산: ${_totalLeft.toLocaleString()}원\n` +
                        `법인카드 지정액: ${_requestedCorp.toLocaleString()}원\n` +
                        `법인카드 금액을 줄이세요 (초과분은 개인카드=자부담으로 처리하면 항목 추가가 가능합니다).`,
                        null, 'block'
                    );
                    return;
                }
            }
            // ────────────────────────────────────────────────────────────────

            // 상품비 검증 (개인카드 사용 불가, 50만원 한도, 클럽 예산 내)
            if (category === ExpenseCategory.PRIZE) {
                const editingId = AppState.editingItemId || null;
                const existingPrize = (AppState.expenseItems || [])
                    .filter(i => i.category === ExpenseCategory.PRIZE && i.id !== editingId)
                    .reduce((s, i) => s + (i.amount || 0), 0);
                const prizeLimit = AppState.rules.prizeLimit || 500000;
                const prizeRemaining = prizeLimit - existingPrize - (AppState.previousPrizeTotal || 0);

                if (prizeRemaining <= 0) {
                    showPrizeModal('상품비 연 한도 50만원을 모두 사용했습니다.\n더 이상 추가할 수 없습니다.', null, 'block');
                    return;
                }
                if (amount > prizeRemaining) {
                    showPrizeModal(`상품비 연 한도 50만원을 초과할 수 없습니다.\n최대 ${prizeRemaining.toLocaleString()}원까지 입력 가능합니다.`, () => {
                        amountInput.value = formatAmount(prizeRemaining);
                        autoSetTogglesAndCorp(); updateCardTypeUI();
                    }, 'warn');
                    return;
                }
                // 클럽 예산 잔여 확인 (상품비도 클럽 예산에서 지출)
                const corpAvail = _calcCorpForItem(amount, category);
                if (corpAvail < amount) {
                    const clubBudget = AppState.getClubBudget ? AppState.getClubBudget() : 0;
                    const clubUsed = AppState.getClubUsedBudget ? AppState.getClubUsedBudget() : 0;
                    const budgetLeft = Math.max(0, clubBudget - clubUsed);
                    showPrizeModal(`클럽 잔여 예산이 부족합니다.\n잔여 예산: ${budgetLeft.toLocaleString()}원\n상품비는 클럽 예산 내에서만 지출 가능합니다.`, null, 'block');
                    return;
                }
            }
            const hadReceipt = !!(AppState.tempCorpReceiptImage || AppState.tempPersonalReceiptImage);
            const syncResult = AppState.addExpense(description, amount, category, corpChecked, personalChecked, corporateAmount);
            if (hadReceipt) {
                const synced = await syncResult;
                if (!synced) {
                    alert('영수증은 항목에 반영됐지만 서버 저장에 실패했습니다. 네트워크를 확인한 뒤 항목을 다시 열어 저장해 주세요.');
                }
            }
            _corpOverLimitApproved = false; // 승인 플래그는 항목 하나당 1회만 유효 — 추가 완료 후 소진
            syncPrizeTotalFromItems();
            descInput.focus();
        }
    });

    // Card type checkbox listeners
    const corpCheck = document.getElementById('expense-corp-check');
    const personalCheck = document.getElementById('expense-personal-check');
    const corporateAmountInput = document.getElementById('expense-corporate-amount-input');
    const personalAmountInput = document.getElementById('expense-personal-amount-input');
    if (corpCheck) corpCheck.addEventListener('change', () => { resetCorpAmount(); updateCardTypeUI(); });
    if (personalCheck) personalCheck.addEventListener('change', updateCardTypeUI);
    if (corporateAmountInput) {
        // 법인카드 금액을 손으로 다시 바꾸면 이전 이사진 승인은 무효화 — 새 금액 기준으로 재확인
        corporateAmountInput.addEventListener('input', () => { _corpOverLimitApproved = false; updateCardTypeUI(); });
    }
    // 총액·카테고리 변경 → 토글 자동 설정 + 구간별 법인카드 계산 후 UI 갱신
    amountInput.addEventListener('input', () => { _corpOverLimitApproved = false; autoSetTogglesAndCorp(); updateCardTypeUI(); });
    if (catSelect) catSelect.addEventListener('change', () => {
        _corpOverLimitApproved = false;
        // 시설·장비 선택 시 임원진 승인 여부를 상기시키는 안내 팝업(확인 버튼만, 계산 분기 없음) — v1.6.232
        if (catSelect.value === ExpenseCategory.FACILITY) {
            showFacilityApprovalModal();
        }
        if (catSelect.value === ExpenseCategory.PRIZE) {
            const memberCount = AppState.memberCount || 0;
            const editingId = AppState.editingItemId || null;
            const existingPrize = (AppState.expenseItems || [])
                .filter(i => i.category === ExpenseCategory.PRIZE && i.id !== editingId)
                .reduce((s, i) => s + (i.amount || 0), 0);
            const prizeLimit = AppState.rules.prizeLimit || 500000;
            // 수정 모드의 previousPrizeTotal은 대상 이력의 기존 상품비를 이미 제외한 값이다.
            const _priorPrizeForCheck = AppState.previousPrizeTotal || 0;
            const remaining = prizeLimit - existingPrize - _priorPrizeForCheck;

            if (memberCount < 10) {
                showPrizeModal('10명 이상일 경우에만 사용 가능합니다.', () => {
                    catSelect.value = ExpenseCategory.EVENT;
                    autoSetTogglesAndCorp(); updateCardTypeUI();
                }, 'block');
                return;
            }
            if (remaining <= 0) {
                showPrizeModal('상품비 연 한도 50만원을 모두 사용했습니다.\n더 이상 상품비를 추가할 수 없습니다.', () => {
                    catSelect.value = ExpenseCategory.EVENT;
                    autoSetTogglesAndCorp(); updateCardTypeUI();
                }, 'block');
                return;
            }
            const priorSettled = _priorPrizeForCheck;
            const infoMsg = (existingPrize === 0 && priorSettled === 0)
                ? `참석자가 10명 이상일 때만 상품비를 사용할 수 있습니다.\n상품비는 한 해에 최대 ${prizeLimit.toLocaleString()}원까지 사용 가능합니다.`
                : `참석자가 10명 이상일 때만 상품비를 사용할 수 있습니다.\n올해 남은 상품비 한도는 ${remaining.toLocaleString()}원입니다.`;
            showPrizeModal(infoMsg, () => { autoSetTogglesAndCorp(); updateCardTypeUI(); }, 'info');
            return;
        }
        autoSetTogglesAndCorp(); updateCardTypeUI();
    });
    updateCardTypeUI();

    // Cancel edit listener
    document.getElementById('cancel-edit-btn').addEventListener('click', () => {
        AppState.cancelEdit();
    });

    // clear-all-btn removed from UI (v1.6.83)

    // 법인카드/개인카드 영수증 업로드 (첨부 완료 시 긴 안내 문구 대신 작은 썸네일 이미지 표시)
    const setupSplitReceiptInput = (inputId, statusId, thumbId, deleteBtnId, stateKey, labelText) => {
        const input = document.getElementById(inputId);
        const status = document.getElementById(statusId);
        const thumb = document.getElementById(thumbId);
        const deleteBtn = document.getElementById(deleteBtnId);
        if (!input || !status) return;

        if (thumb) {
            thumb.addEventListener('click', () => {
                if (!AppState[stateKey]) return;
                const modal = document.getElementById('receipt-modal');
                const modalImg = document.getElementById('modal-img');
                const captionText = document.getElementById('modal-caption');
                if (modal && modalImg && captionText) {
                    modalImg.src = AppState[stateKey];
                    captionText.textContent = `${labelText} 영수증 미리보기`;
                    modal.classList.remove('hidden');
                }
            });
        }

        input.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                status.textContent = "⌛ 압축 중...";
                status.classList.remove('hidden');
                if (thumb) thumb.classList.add('hidden');
                compressReceiptImage(file, (compressedBase64) => {
                    if (!AppState.isDraftMediaWithinLimit({ [stateKey]: compressedBase64 })) {
                        status.textContent = `⚠ 첨부 용량 초과`;
                        if (thumb && AppState[stateKey]) {
                            thumb.src = AppState[stateKey];
                            thumb.classList.remove('hidden');
                        }
                        if (deleteBtn) deleteBtn.classList.toggle('hidden', !AppState[stateKey]);
                        return;
                    }
                    AppState[stateKey] = compressedBase64;
                    status.classList.add('hidden');
                    if (thumb) {
                        thumb.src = compressedBase64;
                        thumb.classList.remove('hidden');
                    }
                    if (deleteBtn) deleteBtn.classList.remove('hidden');
                }, MediaStoragePolicy.receipt, err => {
                    status.textContent = `⚠ ${err.message || '압축 실패'}`;
                });
            } else {
                AppState[stateKey] = null;
                status.classList.add('hidden');
                if (thumb) { thumb.src = ''; thumb.classList.add('hidden'); }
                if (deleteBtn) deleteBtn.classList.add('hidden');
            }
        });

        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                AppState[stateKey] = null;
                status.classList.add('hidden');
                if (thumb) { thumb.src = ''; thumb.classList.add('hidden'); }
                input.value = '';
                deleteBtn.classList.add('hidden');
            });
        }
    };

    setupSplitReceiptInput('expense-receipt-corp-input', 'receipt-corp-status', 'receipt-corp-thumb', 'delete-receipt-corp-btn', 'tempCorpReceiptImage', '법인카드');
    setupSplitReceiptInput('expense-receipt-personal-input', 'receipt-personal-status', 'receipt-personal-thumb', 'delete-receipt-personal-btn', 'tempPersonalReceiptImage', '개인카드');

    // Lightbox modal close handler
    const receiptModal = document.getElementById('receipt-modal');
    if (receiptModal) {
        const closeBtn = receiptModal.querySelector('.modal-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                receiptModal.classList.add('hidden');
            });
        }
        receiptModal.addEventListener('click', (e) => {
            if (e.target === receiptModal) {
                receiptModal.classList.add('hidden');
            }
        });
    }

    // Email modal actions
    const emailReportModal = document.getElementById('email-report-modal');
    const sendEmailBtn = document.getElementById('send-email-btn');
    const closeEmailModal = document.getElementById('close-email-modal');
    const downloadExcelBtn = document.getElementById('download-excel-btn');
    const triggerMailtoBtn = document.getElementById('trigger-mailto-btn');

    if (sendEmailBtn) {
        sendEmailBtn.addEventListener('click', async () => {
            if (AppState.expenseItems.length === 0) {
                alert('정산할 비용 항목을 하나 이상 등록해주세요.');
                return;
            }

            // 회사 이메일 주소 확인
            let recipientEmail = (AppState.reportEmail || '').trim();
            if (!recipientEmail) {
                const prompted = prompt('정산 보고서를 수신할 본인 회사 이메일 주소를 입력해주세요:\n(설정 ⚙️ 버튼에서도 언제든 변경하실 수 있습니다)', '');
                if (prompted && prompted.trim()) {
                    recipientEmail = prompted.trim();
                    AppState.reportEmail = recipientEmail;
                    if (AppState.isLoggedIn && AppState.firebaseDb && AppState.currentPin) {
                        AppState.firebaseDb.ref(`users/${AppState.currentPin}/email`).set(recipientEmail).catch(() => {});
                    }
                    AppState.save();
                    const emailEl = document.getElementById('setting-report-email');
                    if (emailEl) emailEl.value = recipientEmail;
                } else {
                    alert('받는 회사 이메일 주소를 입력하셔야 정산 완료 및 이메일 발송을 진행할 수 있습니다.');
                    const panel = document.getElementById('settings-panel');
                    if (panel) {
                        panel.classList.remove('hidden');
                        const emailEl = document.getElementById('setting-report-email');
                        if (emailEl) emailEl.focus();
                    }
                    return;
                }
            }

            const senderEmail = 'Gochujangs33@gmail.com';
            const willSaveExcel = AppState.saveExcelToDevice !== false;
            const isEditMode = Boolean(AppState.editingHistoryId);

            const confirmMsg = isEditMode
                ? (`수신 메일 : ${recipientEmail}\n` +
                   `디바이스 저장 : ${willSaveExcel ? '활성화' : '비활성화'}\n\n` +
                   `📷 행사 사진 및 영수증 사진은 엑셀 파일에 첨부되어 이메일로 발송되며, DB 서버에는 저장되지 않습니다.\n\n` +
                   `수정 완료 확인 시 수정된 정산 내역 저장 및 메일이 재발송되며 현재 화면이 초기화됩니다.`)
                : (`수신 메일 : ${recipientEmail}\n` +
                   `디바이스 저장 : ${willSaveExcel ? '활성화' : '비활성화'}\n\n` +
                   `📷 행사 사진 및 영수증 사진은 엑셀 파일에 첨부되어 이메일로 발송되며, DB 서버에는 저장되지 않습니다.\n\n` +
                   `정산 완료 확인 시 현재 화면이 초기화됩니다.`);

            // ── 관리자 DB 중복 정산 사전 검증 (이메일 발송/엑셀 다운로드 전 원천 차단) ──
            const duplicate = await AppState.checkDuplicateSettlement();
            if (duplicate) {
                AppState.showDuplicateSettlementAlert(duplicate);
                return;
            }

            showConfirmModal(
                confirmMsg,
                async () => {
                    let excelDownloaded = false;
                    sendEmailBtn.disabled = true;
                    sendEmailBtn.innerHTML = `<span class='btn-icon'>⏳</span> ${isEditMode ? '수정 처리 중...' : '정산 처리 중...'}`;

                    try {
                        // 1. 디바이스 저장 옵션 체크 시 엑셀 다운로드 실행 (수정 모드에서는 여기서 이력/세션 초기화를 건너뜀)
                        if (willSaveExcel) {
                            sendEmailBtn.innerHTML = `<span class='btn-icon'>⏳</span> 엑셀 파일 저장 중...`;
                            await AppState.downloadExcelOnly(isEditMode);
                            excelDownloaded = true;
                        }

                        // 2. 이메일 보고서 생성 및 발송 (수정 모드일 때는 수정된 내역으로 재발송)
                        sendEmailBtn.innerHTML = `<span class='btn-icon'>⏳</span> ${isEditMode ? '수정 메일 재발송 중...' : '이메일 발송 준비 중...'}`;
                        const report = AppState.generateEmailReport();
                        const emailResult = await AppState.sendReportEmail(recipientEmail, senderEmail, report.subject, report.body);

                        const todayStr = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
                        if (isEditMode) {
                            // 3-A. 수정 모드: 이력 업데이트 후 수정 모드 해제 및 세션 초기화
                            sendEmailBtn.innerHTML = '<span class="btn-icon">⏳</span> 수정 저장 중...';
                            const _sdi = document.getElementById('settlement-date-input');
                            const settlementDate = (_sdi && _sdi.value)
                                ? _sdi.value : (AppState._editingHistoryOriginal?.settlementDate || formatLocalDateYMD());
                            const result = SettlementCalculator.calculate(
                                AppState.memberCount, AppState.expenseItems, AppState.previousPrizeTotal, AppState.rules
                            );
                            const finalTotalSelfPay = AppState.selfPayManuallyOverridden
                                ? AppState.lastCalculatedSelfPay : Math.round(result.itemSelfPay);
                            const updatedFields = {
                                memberCount: AppState.memberCount,
                                nonMemberCount: AppState.nonMemberCount || 0,
                                eventNote: AppState.eventNote || '',
                                totalCost: result.totalCost,
                                prizeCost: result.prizeCost,
                                finalSupportAmount: result.totalCost - finalTotalSelfPay,
                                totalSelfPay: finalTotalSelfPay,
                                perPersonSelfPay: AppState.memberCount > 0
                                    ? Math.round(finalTotalSelfPay / AppState.memberCount)
                                    : result.perPersonSelfPay,
                                selfPayRatio: result.totalCost > 0 ? finalTotalSelfPay / result.totalCost : 0,
                                expenseItems: JSON.parse(JSON.stringify(AppState.expenseItems)),
                                attendees: JSON.parse(JSON.stringify(AppState.attendees)),
                                eventPhotos: JSON.parse(JSON.stringify(AppState.eventPhotos || [])),
                                clubName: AppState.clubName,
                                clubId: AppState.clubId || '',
                                settlementDate,
                            };
                            await AppState.updateHistoryEntry(AppState.editingHistoryId, updatedFields);
                            AppState.cancelEditMode();
                            resetSettlementSession();
                        } else {
                            // 3-B. 신규 정산 확정 (Firebase 이력 저장, 누적 카운트 반영, 세션 초기화)
                            sendEmailBtn.innerHTML = '<span class="btn-icon">⏳</span> 정산 저장 중...';
                            const completed = await runFinalizeSettlement(true);
                            if (!completed) return;
                        }

                        sendEmailBtn.innerHTML = `<span class='btn-icon'>✓</span> ${t('state.saved')}`;

                        const attachNotice = (emailResult && emailResult.method === 'apps_script')
                            ? `📎 메일 첨부: 정산서 엑셀 파일(${emailResult.fileName || '정산서.xlsx'}) 동봉 완료\n`
                            : '';
                        const saveNotice = willSaveExcel
                            ? `📂 ${todayStr} 정산 엑셀 파일이 디바이스(다운로드 폴더)에 저장되었습니다.\n`
                            : `📂 설정에 따라 디바이스 엑셀 저장은 건너뛰었습니다.\n`;

                        alert(
                            `✅ ${todayStr} ${isEditMode ? '정산 수정이' : '정산이'} 정상적으로 완료되었습니다!\n\n` +
                            `📧 ${isEditMode ? '수정 메일 재발송' : '이메일 발송'}: [${senderEmail}] → [${recipientEmail}]\n` +
                            attachNotice +
                            saveNotice +
                            `✅ 현재 입력 항목이 초기화되었습니다.\n` +
                            `📋 이번 정산 내역은 [정산 이력] 탭에서 언제든 확인하실 수 있습니다.`
                        );
                    } catch (err) {
                        console.error('정산 처리 실패:', err);
                        sendEmailBtn.innerHTML = `<span class='btn-icon'>❌</span> ${t('state.save_failed')}`;
                        if (excelDownloaded) alert(t('alert.save_error_network'));
                        else alert('정산 처리 중 오류가 발생했습니다: ' + (err.message || err));
                    } finally {
                        setTimeout(() => {
                            sendEmailBtn.innerHTML = AppState.editingHistoryId
                                ? `<span class='btn-icon'>✅</span> 수정 완료`
                                : `<span class='btn-icon'>💾</span> 정산 완료`;
                            sendEmailBtn.disabled = !AppState.hasSelectedClub();
                        }, 2000);
                    }
                },
                isEditMode ? '수정 완료' : '정산 완료',
                isEditMode ? '정산 수정 완료 확인' : '정산 완료 확인',
                isEditMode ? '✅' : '💾'
            );
        });
    }

    if (closeEmailModal && emailReportModal) {
        closeEmailModal.addEventListener('click', () => {
            emailReportModal.classList.add('hidden');
        });
        emailReportModal.addEventListener('click', (e) => {
            if (e.target === emailReportModal) {
                emailReportModal.classList.add('hidden');
            }
        });
    }

    async function runFinalizeSettlement(skipConfirm = false) {
        const completed = await AppState.finalizeSettlement(skipConfirm);
        if (!completed) return false;
        if (emailReportModal) emailReportModal.classList.add('hidden');
        // Reset form UI state (영수증 썸네일·임시 이미지·입력란 일괄 초기화)
        AppState.cancelEdit();
        if (typeof AppState.cancelEditAttendee === 'function') AppState.cancelEditAttendee();
        document.getElementById('prev-prize-input').value = formatAmount(AppState.previousPrizeTotal);
        // Switch to history tab
        document.querySelectorAll('.tab-nav .tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
        const histTab = document.querySelector('[data-tab="tab-history"]');
        if (histTab) { histTab.classList.add('active'); document.getElementById('tab-history').classList.remove('hidden'); }
        return true;
    }

    const finalizeBtn = document.getElementById('finalize-settlement-btn');
    if (finalizeBtn) {
        finalizeBtn.addEventListener('click', async () => {
            const originalText = finalizeBtn.innerHTML;
            let completed = false;
            finalizeBtn.disabled = true;
            try {
                completed = await runFinalizeSettlement(false);
                if (completed) finalizeBtn.innerHTML = `<span class='btn-icon'>✓</span> ${t('state.saved')}`;
            } catch (err) {
                console.error(err);
                finalizeBtn.innerHTML = `<span class='btn-icon'>❌</span> ${t('state.save_failed')}`;
                alert(t('alert.save_error_network'));
            } finally {
                const restoreButton = () => {
                    finalizeBtn.innerHTML = originalText;
                    finalizeBtn.disabled = false;
                };
                if (completed) setTimeout(restoreButton, 2000);
                else restoreButton();
            }
        });
    }


    if (downloadExcelBtn) {
        downloadExcelBtn.addEventListener('click', async () => {
            const originalText = downloadExcelBtn.innerHTML;
            downloadExcelBtn.innerHTML = `<span class='btn-icon'>⏳</span> ${t('state.generating')}`;
            downloadExcelBtn.disabled = true;
            try {
                await AppState.downloadExcelOnly();
                downloadExcelBtn.innerHTML = `<span class='btn-icon'>✓</span> ${t('state.downloading')}`;
                const excelSavedModal = document.getElementById('excel-saved-modal');
                if (excelSavedModal) excelSavedModal.classList.remove('hidden');
            } catch (err) {
                console.error(err);
                downloadExcelBtn.innerHTML = `<span class='btn-icon'>❌</span> ${t('state.download_failed')}`;
            } finally {
                setTimeout(() => {
                    downloadExcelBtn.innerHTML = originalText;
                    downloadExcelBtn.disabled = false;
                }, 2000);
            }
        });
    }

    // 엑셀 저장 완료 후 화면 초기화 여부 확인 모달
    const excelSavedModal = document.getElementById('excel-saved-modal');
    const excelSavedResetBtn = document.getElementById('excel-saved-reset-btn');
    const excelSavedKeepBtn = document.getElementById('excel-saved-keep-btn');
    if (excelSavedResetBtn) {
        excelSavedResetBtn.addEventListener('click', async () => {
            excelSavedResetBtn.disabled = true;
            try {
                const completed = await runFinalizeSettlement(true);
                if (completed) excelSavedModal.classList.add('hidden');
            } catch (err) {
                console.error(err);
                alert(t('alert.save_error_network'));
            } finally {
                excelSavedResetBtn.disabled = false;
            }
        });
    }
    if (excelSavedKeepBtn) {
        excelSavedKeepBtn.addEventListener('click', () => {
            excelSavedModal.classList.add('hidden');
        });
    }

    const shareReportBtn = document.getElementById('share-report-btn');
    if (shareReportBtn) {
        shareReportBtn.addEventListener('click', () => {
            AppState.shareSettlementReport();
        });
    }

    if (triggerMailtoBtn) {
        triggerMailtoBtn.addEventListener('click', async () => {
            const receiver = document.getElementById('email-to-field').value;
            const subject = document.getElementById('email-subject-field').value;
            const body = document.getElementById('email-body-field').value;
            const mailtoUrl = `mailto:${encodeURIComponent(receiver)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

            if (window.AndroidShare && typeof window.AndroidShare.shareFiles === 'function') {
                AppState.shareSettlementReport(receiver, subject, body);
                return;
            }

            // 웹: navigator.share로 파일 첨부를 시도하고, 안 되면 파일 다운로드 후 mailto로 본문만 전달
            if (navigator.canShare) {
                try {
                    const files = await AppState.collectReportFiles();
                    if (files.length > 0 && navigator.canShare({ title: subject, text: body, files })) {
                        await navigator.share({ title: subject, text: body, files });
                        return;
                    }
                } catch (err) {
                    if (err.name === 'AbortError') return;
                    console.error(err);
                }
            }

            await AppState.downloadReportFiles();
            window.location.href = mailtoUrl;
        });
    }

    // Event photo upload handler (여러 장 지원)
    const eventPhotoInput = document.getElementById('event-photo-input');
    const eventPhotoStatus = document.getElementById('event-photo-status');

    if (eventPhotoInput) {
        eventPhotoInput.addEventListener('change', async (e) => {
            const files = Array.from(e.target.files);
            if (!files.length) return;
            eventPhotoInput.value = '';
            if (eventPhotoStatus) {
                eventPhotoStatus.textContent = `⌛ 행사 사진 ${files.length}장을 저용량 변환 중입니다...`;
                eventPhotoStatus.style.color = 'var(--text-muted)';
            }
            try {
                const compressed = await Promise.all(files.map(file =>
                    compressImageForStorage(file, MediaStoragePolicy.event)
                ));
                const accepted = [];
                let rejected = 0;
                compressed.forEach(({ dataUrl }) => {
                    const candidate = [...(AppState.eventPhotos || []), ...accepted, dataUrl];
                    if (AppState.isDraftMediaWithinLimit({ eventPhotos: candidate })) {
                        accepted.push(dataUrl);
                    } else {
                        rejected++;
                    }
                });
                if (accepted.length === 0) {
                    throw new Error(`첨부 합계가 ${formatMediaSize(MediaStoragePolicy.maxSettlementBytes)}를 초과합니다. 일부 사진을 삭제한 뒤 다시 시도해 주세요.`);
                }
                AppState.eventPhotos.push(...accepted);
                AppState.render();
                await AppState.save();
                const totalBytes = accepted.reduce((sum, value) => sum + getMediaDataSize(value), 0);
                if (eventPhotoStatus) {
                    eventPhotoStatus.textContent = `✓ ${accepted.length}장 이 기기에 임시 저장 완료 (${formatMediaSize(totalBytes)} · 엑셀·메일 발송 시 포함)${rejected ? ` · ${rejected}장은 용량 초과로 제외` : ''}`;
                    eventPhotoStatus.style.color = 'var(--color-secondary)';
                }
            } catch (err) {
                console.error('행사 사진 저장 실패:', err);
                if (eventPhotoStatus) {
                    eventPhotoStatus.textContent = `⚠ ${err.message || '행사 사진 저장에 실패했습니다.'}`;
                    eventPhotoStatus.style.color = 'var(--warning-text)';
                }
            }
        });
    }

    // 개별 사진 삭제 — preview 컨테이너에 위임 방식으로 등록
    const eventPhotoPreviewEl = document.getElementById('event-photo-preview');
    if (eventPhotoPreviewEl) {
        eventPhotoPreviewEl.addEventListener('click', (e) => {
            const btn = e.target.closest('.del-event-photo-btn');
            if (!btn) return;
            const idx = parseInt(btn.dataset.pidx, 10);
            if (!isNaN(idx)) {
                AppState.eventPhotos.splice(idx, 1);
                AppState.render();
                AppState.save().then(() => {
                    if (!eventPhotoStatus) return;
                    eventPhotoStatus.textContent = '✓ 행사 사진 삭제 내용이 이 기기에 반영됐습니다.';
                    eventPhotoStatus.style.color = 'var(--color-secondary)';
                });
            }
        });
    }

    // 요청사항 알림 팝업 (관리자용)
    const seenFeedbackKeys = new Set();
    const feedbackPopupQueue = [];
    let feedbackPopupShowing = false;

    function showNextFeedbackPopup() {
        if (feedbackPopupShowing || feedbackPopupQueue.length === 0) return;
        const req = feedbackPopupQueue.shift();
        feedbackPopupShowing = true;

        const popupModal = document.getElementById('feedback-popup-modal');
        const popupBody = document.getElementById('feedback-popup-body');
        const dateStr = req.createdAt ? new Date(req.createdAt).toLocaleString('ko-KR') : '-';
        const photoHtml = req.photo
            ? `<img src="${req.photo}" alt="첨부 사진" style="max-width:100%; max-height:240px; border-radius:8px; margin-top:0.5rem; display:block; object-fit:contain;">`
            : '';
        popupBody.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem;">
                <strong style="font-size:0.95rem;">${AppState.escapeHtml(req.userName || '알 수 없음')}${req.clubName ? ` (${AppState.escapeHtml(req.clubName)})` : ''}</strong>
                <span style="font-size:0.75rem; color:var(--text-muted); white-space:nowrap;">${dateStr}</span>
            </div>
            <p style="font-size:0.9rem; margin:0.6rem 0 0; white-space:pre-wrap;">${AppState.escapeHtml(req.message || '')}</p>
            ${photoHtml}
        `;
        popupModal.classList.remove('hidden');

        const confirmBtn = document.getElementById('feedback-popup-confirm-btn');
        confirmBtn.onclick = () => {
            popupModal.classList.add('hidden');
            feedbackPopupShowing = false;
            if (firebaseDb) {
                const requestUpdates = { [`requests/${req.key}/read`]: true };
                AppState.appendAuditUpdate(requestUpdates, {
                    action: 'UPDATE',
                    targetType: '요청사항',
                    targetId: req.key,
                    targetLabel: (req.message || '').slice(0, 80),
                    summary: `요청사항 확인 완료 처리: ${(req.message || '').slice(0, 120)}`,
                    details: { 요청자: req.userName || '', 요청자PIN: req.pin || '' }
                });
                firebaseDb.ref().update(requestUpdates).then(() => {
                    renderFeedbackList();
                });
            }
            const listOpenBtn = document.getElementById('feedback-list-open-btn');
            if (listOpenBtn) listOpenBtn.classList.remove('hidden');
            showNextFeedbackPopup();
        };
    }

    const feedbackListOpenBtn = document.getElementById('feedback-list-open-btn');
    const feedbackListModal = document.getElementById('feedback-list-modal');
    const closeFeedbackListModalBtn = document.getElementById('close-feedback-list-modal');

    if (feedbackListOpenBtn) {
        feedbackListOpenBtn.addEventListener('click', () => {
            renderFeedbackList();
            feedbackListModal.classList.remove('hidden');
        });
    }
    if (closeFeedbackListModalBtn) {
        closeFeedbackListModalBtn.addEventListener('click', () => {
            feedbackListModal.classList.add('hidden');
        });
    }

    const feedbackDeleteSelectedBtn = document.getElementById('feedback-delete-selected-btn');
    if (feedbackDeleteSelectedBtn) {
        feedbackDeleteSelectedBtn.addEventListener('click', () => {
            const checked = document.querySelectorAll('.feedback-select-checkbox:checked');
            if (checked.length === 0) {
                alert(t('alert.select_items_to_delete'));
                return;
            }
            showConfirmModal(
                `선택한 ${checked.length}건의 요청사항을 삭제하시겠습니까?`,
                () => {
                    const updates = {};
                    checked.forEach(cb => { updates[`requests/${cb.getAttribute('data-key')}`] = null; });
                    AppState.appendAuditUpdate(updates, {
                        action: 'DELETE',
                        targetType: '요청사항',
                        targetLabel: `선택 요청사항 ${checked.length}건`,
                        summary: `선택한 요청사항 ${checked.length}건 일괄 삭제`,
                        details: { 삭제건수: checked.length }
                    });
                    firebaseDb.ref().update(updates).then(() => {
                        renderFeedbackList();
                    });
                }
            );
        });
    }

    // 요청사항(피드백) 모달
    const feedbackOpenBtn = document.getElementById('feedback-open-btn');
    const feedbackModal = document.getElementById('feedback-modal');
    const closeFeedbackModalBtn = document.getElementById('close-feedback-modal');
    const feedbackMessageInput = document.getElementById('feedback-message-input');
    const feedbackPhotoInput = document.getElementById('feedback-photo-input');
    const feedbackPhotoPreview = document.getElementById('feedback-photo-preview');
    const feedbackPhotoImg = document.getElementById('feedback-photo-img');
    const feedbackPhotoRemoveBtn = document.getElementById('feedback-photo-remove-btn');
    const feedbackSubmitBtn = document.getElementById('feedback-submit-btn');
    const feedbackStatus = document.getElementById('feedback-status');
    let feedbackPhotoData = null;

    if (feedbackOpenBtn) {
        feedbackOpenBtn.addEventListener('click', () => {
            feedbackMessageInput.value = '';
            feedbackPhotoData = null;
            feedbackPhotoPreview.classList.add('hidden');
            feedbackPhotoImg.src = '';
            feedbackPhotoInput.value = '';
            feedbackStatus.textContent = '';
            feedbackModal.classList.remove('hidden');
        });
    }

    if (feedbackModal && closeFeedbackModalBtn) {
        closeFeedbackModalBtn.addEventListener('click', () => {
            feedbackModal.classList.add('hidden');
        });
    }

    if (feedbackPhotoInput) {
        feedbackPhotoInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                compressReceiptImage(file, (compressed) => {
                    feedbackPhotoData = compressed;
                    feedbackPhotoImg.src = compressed;
                    feedbackPhotoPreview.classList.remove('hidden');
                }, MediaStoragePolicy.feedback);
            }
        });
    }

    if (feedbackPhotoRemoveBtn) {
        feedbackPhotoRemoveBtn.addEventListener('click', () => {
            feedbackPhotoData = null;
            feedbackPhotoInput.value = '';
            feedbackPhotoPreview.classList.add('hidden');
            feedbackPhotoImg.src = '';
        });
    }

    if (feedbackSubmitBtn) {
        feedbackSubmitBtn.addEventListener('click', () => {
            const message = feedbackMessageInput.value.trim();
            if (!message && !feedbackPhotoData) {
                feedbackStatus.textContent = '메시지나 사진을 입력해주세요.';
                return;
            }
            if (!firebaseDb) {
                feedbackStatus.textContent = '온라인 상태에서만 요청을 보낼 수 있습니다.';
                return;
            }
            feedbackSubmitBtn.disabled = true;
            feedbackStatus.textContent = '전송 중...';

            const requestData = {
                userName: AppState.userName || '알 수 없음',
                pin: AppState.currentPin || '',
                clubName: AppState.clubName || '',
                message: message,
                photo: feedbackPhotoData || null,
                read: false,
                createdAt: Date.now()
            };

            const requestKey = firebaseDb.ref('requests').push().key;
            const requestUpdates = { [`requests/${requestKey}`]: requestData };
            AppState.appendAuditUpdate(requestUpdates, {
                action: 'CREATE',
                targetType: '요청사항',
                targetId: requestKey,
                targetLabel: message.slice(0, 80),
                summary: `요청사항 등록: ${message.slice(0, 120)}`,
                details: { 첨부사진여부: !!feedbackPhotoData, 글자수: message.length }
            });
            // 2. 개발자(jkim47@mmm.com) 이메일 동시 발송 (Gochujangs33@gmail.com 발신)
            const emailSubject = `[3M 정산기 요청/버그] ${requestData.userName} (${requestData.clubName || '미지정'})`;
            const emailBody = [
                `[3M 사내 동아리·클럽 비용 정산기 - 사용자 요청/버그 신고 접수]`,
                ``,
                `• 접수 일시: ${new Date(requestData.createdAt).toLocaleString('ko-KR')}`,
                `• 작성자: ${requestData.userName} (PIN: ${requestData.pin})`,
                `• 소속 클럽: ${requestData.clubName || '미지정'}`,
                ``,
                `[요청 내용]`,
                message,
                ``,
                requestData.photo ? `(※ 첨부 이미지가 포함되어 있습니다. 관리자 대시보드 요청 목록에서 확인하실 수 있습니다.)` : `(첨부 이미지 없음)`,
                ``,
                `--------------------------------------------------`,
                `이 메일은 3M 클럽 비용 정산기에서 Gochujangs33@gmail.com 계정을 통해 개발자(jkim47@mmm.com)에게 자동 전달되었습니다.`
            ].join('\n');

            Promise.allSettled([
                firebaseDb.ref().update(requestUpdates),
                AppState.sendReportEmail('jkim47@mmm.com', 'Gochujangs33@gmail.com', emailSubject, emailBody)
            ]).then((results) => {
                const fbResult = results[0];
                if (fbResult.status === 'fulfilled') {
                    feedbackStatus.textContent = '요청이 관리자 팝업 및 개발자 메일로 전송되었습니다!';
                    setTimeout(() => {
                        feedbackModal.classList.add('hidden');
                        feedbackSubmitBtn.disabled = false;
                    }, 1200);
                } else {
                    console.error('요청 전송 실패:', fbResult.reason);
                    feedbackStatus.textContent = '전송에 실패했습니다. 다시 시도해주세요.';
                    feedbackSubmitBtn.disabled = false;
                }
            });
        });
    }

    // Total self-pay manual adjustment handler
    const selfPayInput = document.getElementById('result-total-self-pay-input');

    function applySelfPayChange() {
        const newValue = parseAmount(selfPayInput.value);
        // 차액은 항상 "자동 계산된 최소 자부담(totalSelfPay)" 대비로 계산 (CALCULATION_SPEC.md L25 규칙과 동일)
        const minSelfPay = Math.round(SettlementCalculator.calculate(
            AppState.memberCount,
            AppState.expenseItems,
            AppState.previousPrizeTotal,
            AppState.rules
        ).totalSelfPay);
        const diff = newValue - minSelfPay;

        if (diff < 0) {
            const minFmt = minSelfPay.toLocaleString();
            const absDiff = Math.abs(diff).toLocaleString();
            showDiffPopup(`⚠️ 사규 최소 기준 미달 ⚠️\n사규 규정상 최소 총 자부담은 ${minFmt}원입니다.\n규정보다 ${absDiff}원 적게 부담할 수 없어 ${minFmt}원으로 자동 복원됩니다.`, diff);
            selfPayInput.value = formatAmount(minSelfPay);
            AppState.lastCalculatedSelfPay = minSelfPay;
            AppState.selfPayManuallyOverridden = false;
            AppState.render();
            return;
        }

        const absDiff = Math.abs(diff).toLocaleString();
        const minFmt = minSelfPay.toLocaleString();
        const popupMsg = diff > 0
            ? `원래 총 자부담: ${minFmt}원 + ${absDiff}원 초과\n정산에 문제 없음`
            : `총 자부담: ${minFmt}원 (자동 계산값과 동일)\n정산에 문제 없음`;
        showDiffPopup(popupMsg, diff);

        AppState.lastCalculatedSelfPay = newValue;
        AppState.selfPayManuallyOverridden = true;

        // 실제 인당 자부담 비용: 수정한 총 자부담(newValue) ÷ 참석자 수 (계산식_명세서.md 5번 명세 준수)
        const calcResult = SettlementCalculator.calculate(
            AppState.memberCount,
            AppState.expenseItems,
            AppState.previousPrizeTotal,
            AppState.rules
        );
        const actualPerPerson = (AppState.memberCount > 0 && newValue > 0)
            ? Math.round(newValue / AppState.memberCount)
            : calcResult.perPersonSelfPay;

        document.getElementById('result-per-person-self-pay').textContent = SettlementCalculator.formatCurrency(actualPerPerson);
        updatePerPersonSelfPayIcon(actualPerPerson);

        const policyNoteEl = document.getElementById('result-per-person-policy-note');
        if (policyNoteEl) {
            const minSelfPayTotal = Math.round(calcResult.totalSelfPay);
            if (AppState.memberCount > 0 && newValue > 0 && Math.abs(newValue - minSelfPayTotal) >= 100) {
                policyNoteEl.textContent = `(사규 최소 기준: ${SettlementCalculator.formatCurrency(Math.round(calcResult.perPersonSelfPay))})`;
                policyNoteEl.classList.remove('hidden');
            } else {
                policyNoteEl.classList.add('hidden');
            }
        }

        const totalCost = AppState.expenseItems.reduce((sum, item) => sum + item.amount, 0);
        const ratio = totalCost > 0 ? newValue / totalCost : 0;
        document.getElementById('result-self-pay-ratio').textContent = `${(ratio * 100).toFixed(1)}%`;

        // 최종 지원금 = 총 소요 비용 - 실제 자부담 (CALCULATION_SPEC.md 4번)
        const finalSupport = totalCost - newValue;
        document.getElementById('result-final-support').textContent = SettlementCalculator.formatCurrency(finalSupport);

        // 이번 최종 지원금 / 이후 잔여 예산 갱신
        // getClubBudget()/getClubUsedBudget() 기준 — 이력 수정 모드에서는 이 이력 자신의 기존 기여분이
        // 자동으로 제외되므로(getClubUsedBudget 참조) 자동계산 표시(render())와 항상 일치함
        const _clubBudgetForSelfPay = AppState.getClubBudget ? AppState.getClubBudget() : (AppState.annualBudget || 0);
        if (_clubBudgetForSelfPay > 0) {
            const clubUsedForSelfPay = AppState.getClubUsedBudget ? AppState.getClubUsedBudget() : AppState.usedBudget;
            const prevRemaining = _clubBudgetForSelfPay - clubUsedForSelfPay;
            const afterRemaining = prevRemaining - finalSupport;
            const supportSubEl = document.getElementById('result-this-support-sub');
            const afterRemainingEl = document.getElementById('result-after-remaining');
            if (supportSubEl) supportSubEl.textContent = SettlementCalculator.formatCurrency(finalSupport);
            if (afterRemainingEl) {
                afterRemainingEl.textContent = SettlementCalculator.formatCurrency(afterRemaining);
                afterRemainingEl.style.color = afterRemaining >= 0 ? 'var(--color-secondary)' : 'var(--warning-text)';
            }
            if (AppState.updateClubBudgetProgress) {
                AppState.updateClubBudgetProgress(_clubBudgetForSelfPay, clubUsedForSelfPay, finalSupport);
            }
        }
    }

    if (selfPayInput) {
        selfPayInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                selfPayInput.blur();
            }
        });
        selfPayInput.addEventListener('blur', () => {
            applySelfPayChange();
        });
        selfPayInput.addEventListener('change', () => {
            applySelfPayChange();
        });
    }

    // Close diff popup on touch/click anywhere
    document.addEventListener('pointerdown', () => {
        const popup = document.getElementById('diff-popup');
        if (popup && !popup.classList.contains('hidden')) {
            popup.classList.add('hidden');
        }
    });

    // 관리자 대시보드 카드 접기/펼치기 (설정은 localStorage에 저장되어 유지됨)
    document.querySelectorAll('.card-collapse-btn').forEach(btn => {
        const cardId = btn.getAttribute('data-card');
        const card = document.getElementById(cardId);
        if (!card) return;
        const storageKey = `card_collapsed_${cardId}`;
        if (localStorage.getItem(storageKey) === '1') {
            card.classList.add('collapsed');
        }
        btn.addEventListener('click', () => {
            const collapsed = card.classList.toggle('collapsed');
            localStorage.setItem(storageKey, collapsed ? '1' : '0');
            syncAdminStartActionState(cardId);
        });
    });

    // PIN 로그인·권한 전환·오프라인 전환 UI는 js/auth-firebase.js 로 분리됨 (v1.7.69)
    const {
        pinModal,
        pinErrorText,
        statusBadge,
        logoutBtn,
        loginBtn,
        updatePinDots,
        resetPinInput,
        handlePinKeyPress,
        syncHeaderAdminButton,
        setAdminMode,
        switchToOfflineMode
    } = window.__installAuthFirebaseUI({
        get firebaseDb() { return firebaseDb; },
        get memberInput() { return memberInput; },
        get prizeInput() { return prizeInput; },
        setSettingsFormValues: (...args) => typeof setSettingsFormValues === 'function' && setSettingsFormValues(...args),
        setAdminRulesFormValues: (...args) => typeof setAdminRulesFormValues === 'function' && setAdminRulesFormValues(...args),
        renderClubOptions: (...args) => typeof renderClubOptions === 'function' && renderClubOptions(...args),
        renderAdminDashboard: (...args) => typeof renderAdminDashboard === 'function' && renderAdminDashboard(...args),
        showNextFeedbackPopup: (...args) => typeof showNextFeedbackPopup === 'function' && showNextFeedbackPopup(...args),
        get seenFeedbackKeys() { return seenFeedbackKeys; },
        get feedbackPopupQueue() { return feedbackPopupQueue; }
    });

    // Toggle to Register mode
    document.getElementById('go-to-register').addEventListener('click', () => {
        document.getElementById('login-mode-section').classList.add('hidden');
        document.getElementById('register-mode-section').classList.remove('hidden');
        document.getElementById('register-name-input').value = '';
        const emailPrefixEl = document.getElementById('register-email-prefix-input');
        if (emailPrefixEl) emailPrefixEl.value = '';
        document.getElementById('register-pin-input').value = '';
        document.getElementById('register-error-text').classList.add('hidden');
    });

    // 변경이력 모달
    const CHANGELOG = [
        { ver: '1.7.80', date: '2026.11.27', items: ['[📋 중간 결산] 팝업 표의 [행사수]에 마우스를 올리면 해당 클럽의 정산 내역(날짜·참석인원·지원금·비고)을, [실참석]에 마우스를 올리면 참석자별 누적 횟수(이름 (N회))를 툴팁으로 즉시 표시'] },
        { ver: '1.7.79', date: '2026.11.27', items: ['차트 탭 [최근 정산 알림]에서 최근 24시간 내 신규 등록 건에 NEW 뱃지를 표시하고, 알림 클릭 시 비용 항목·법인/개인카드 배분·참석자 명단을 한눈에 볼 수 있는 [정산 내역 상세] 모달 오픈', '관리자 [클럽별 정산이력]·[클럽 사용 요약] 행 클릭 시에도 정산 내역 및 참석자 명단을 즉시 확인할 수 있도록 연동'] },
        { ver: '1.7.78', date: '2026.11.26', items: ['시설·장비 전액 또는 85,000원 초과 지원 승인을 받아 완료된 정산 이력을 추후 수정할 때, 해당 이력 수정 중에는 기존 승인 상태가 그대로 유지되어 재승인 없이 수정 가능하도록 개선 (기존 저장된 구버전 이력도 자동 인식)'] },
        { ver: '1.7.77', date: '2026.11.26', items: ['라이트 모드 대시보드 [현재 사용 금액] 오렌지 색상(#c2410c) 및 [예산 소진율 80%↑] 경고 색상(rgb(217, 119, 6))의 대비를 높여 가독성 개선', '전사원 명부 "(올해 누적: N회)"를 실시간 자동 집계 전용 읽기 전용 표시로 변경해 불필요한 수동 입력란 제거'] },
        { ver: '1.7.76', date: '2026.11.26', items: ['기존 DB 사진 데이터 정리가 완료되어 관리자 페이지의 일회성 [DB 기존 사진 데이터 정리] 카드 및 관련 코드 제거'] },
        { ver: '1.7.75', date: '2026.11.26', items: ['정산 완료·수정 완료 확인 팝업에 행사·영수증 사진이 엑셀에 첨부되어 이메일로 발송되며 DB 서버에는 저장되지 않는다는 안내 문구 추가', '행사 사진 첨부·삭제 안내 문구를 실제 동작(이 기기에 임시 저장)과 일치하도록 개선'] },
        { ver: '1.7.74', date: '2026.11.26', items: ['영수증·행사 사진(Base64)을 Firebase DB(globalHistory·settlements)에 저장하지 않도록 개선 (엑셀·이메일 발송 시에는 메모리/로컬 상태 그대로 정상 포함)', '한국 로컬 시간대 날짜 유틸(formatLocalDateYMD)을 도입해 새벽 시간대(00:00~08:59) UTC 전날 밀림 버그 14곳 일괄 수정', '미사용 PPT 차트 이미지 헬퍼 제거 및 핵심 계산·날짜·미디어 정책 자동 검증 테스트(tests/verify_core.js) 추가'] },
        { ver: '1.7.73', date: '2026.11.26', items: ['차트 탭 [최근 정산 알림]을 행사일순이 아닌 실제 입력(등록) 날짜·시간 최신순으로 정렬·필터링해 몇 달 전 정산을 지금 입력해도 최상단에 즉시 표시되도록 개선'] },
        { ver: '1.7.72', date: '2026.11.26', items: ['차트 탭 [최근 정산 알림] 표시 범위를 최신 5건에서 최근 2개월 전체로 확대하고 목록 스크롤(마우스 휠) 지원', '관리자 [클럽 관리] 상품비 금액에 마우스를 올리면 날짜별 상품비 입력 내역을 툴팁으로 즉시 표시'] },
        { ver: '1.7.71', date: '2026.11.26', items: ['전체 모듈 코드 정적 감사 및 정리: 미사용 구버전 함수(clearAll·updateAttendance·updateRemainingDisplay) 제거 및 클럽 미선택 시 구형 셀렉터(#club-select → #club-name-select) 포커스 이동 보완'] },
        { ver: '1.7.70', date: '2026.11.26', items: ['연도별 정산 구간·비율·한도 설정을 전용 모듈(js/rules-manager.js)로 분리하고, 신규 연도 설정 미입력 시 직전 연도 설정을 자동 승계하도록 보완 (조회 연도 전환 시 이전 연도 값 즉시 표시)'] },
        { ver: '1.7.69', date: '2026.11.26', items: ['PIN 로그인·권한 전환·오프라인 전환 및 Firebase 부트스트랩(loadFromFirebase·loadClubRegistry·loadGlobalSettings)을 전용 모듈(js/auth-firebase.js)로 분리'] },
        { ver: '1.7.68', date: '2026.11.26', items: ['공통 모달(showConfirmModal·showAlertModal·showEditModal·showPrizeModal)·정산 규정 안내·전역 툴팁·이미지 압축 유틸을 전용 모듈(js/ui-modals.js)로 분리'] },
        { ver: '1.7.67', date: '2026.11.26', items: ['관리자 계정·권한·작업 로그·요청사항(피드백) 관리 UI를 전용 모듈(js/admin-users-audit.js)로 분리'] },
        { ver: '1.7.66', date: '2026.11.26', items: ['관리자 대시보드·사용 요약·연도 전환·이력 조회 UI를 전용 모듈(js/admin-dashboard.js)로 분리해 대시보드·차트·클럽 관리 간 브릿지 구조 정립'] },
        { ver: '1.7.65', date: '2026.11.26', items: ['이메일 보고서 생성·발송 및 파일 공유/다운로드 기능을 전용 모듈(js/email-report.js)로 분리해 외부 발송·메일 서식 관리 격리'] },
        { ver: '1.7.64', date: '2026.11.26', items: ['정산 이력 유틸·수정·확정·중복체크 엔진을 전용 모듈(js/settlement-history.js)로 분리해 메인 스크립트 결합도 및 구문 오류 전파 위험 최소화'] },
        { ver: '1.7.63', date: '2026.11.26', items: ['클럽별 정회원 관리 전용 모듈(js/regular-members.js) 분리 및 연도별 독립 관리 적용 (새 연도 이월 승계 + 변경 시 연도별 분리 저장 + 전년도 조회 시 전년도 명단 표시)', '정회원 관리 모달 명단 카드형 행 디자인 개선 및 행 간격·여백 확대, 대상 클럽 옆 기준 연도 뱃지 추가'] },
        { ver: '1.7.62', date: '2026.11.25', items: ['정회원 관리 모달 하단 [⭐ 현재 참석자로 바로 불러오기] 버튼 제거 (정회원 등록·관리 전용으로 간소화)'] },
        { ver: '1.7.61', date: '2026.11.25', items: ['공통 알림·확인 모달(#confirm-modal-overlay) z-index를 20000으로 상향해 정회원 관리 등 다른 모달 위에서도 항상 맨 앞에 표시되도록 수정'] },
        { ver: '1.7.60', date: '2026.11.25', items: ['정회원 관리 모달 대상 클럽을 변경 불가한 고정 클럽명 표시로 변경하고 일괄 추가 버튼 2개(+ 현재/종전 참석자에서 추가) 제거', '정회원 관리 이름 검색 시 동명이인 최근 참석자 표시가 어느 클럽에서 열어도 누락되지 않도록 전체 이력 기준 보조 표시 및 자동 로드 보강'] },
        { ver: '1.7.59', date: '2026.11.25', items: ['정산 보고서 메일 발송 시 본문 글꼴을 "맑은 고딕", 글자 크기를 9pt HTML 서식으로 전송하도록 개선 (앱 및 Google Apps Script 동시 반영)'] },
        { ver: '1.7.58', date: '2026.11.25', items: ['삭제·비우기·완료·안내 등 모든 상단 브라우저 팝업(alert/confirm)을 화면 정가운데 인앱 커스텀 모달로 전면 통일', '관리자 클럽 관리의 정회원 버튼 문구에서 인원수 표기를 제거하고 "정회원"으로 간소화'] },
        { ver: '1.7.57', date: '2026.11.25', items: ['정회원 관리 모달 이름 검색 시 동명이인 최근 참석자(✅ 최근 참석) 강조 표시 및 선택 후 Enter로 바로 추가 지원', '정산 수정 모드에서 상단 취소 버튼을 제거하고 우측 하단 [수정 완료] 버튼 아래 [❌ 수정 취소] 버튼 배치', '관리자 클럽 관리 헤더 "상품비(한도 50만원)"를 "상품비"로 축약하고 열 폭을 최적화해 우측 삭제 버튼 잘림 해소', '중간 결산 팝업 및 엑셀 출력의 "정회원" 컬럼명을 "총 참석자"로 변경'] },
        { ver: '1.7.56', date: '2026.11.25', items: ['정산 수정 모드에서 상단 수정 완료 버튼을 제거하고 우측 하단 버튼을 [수정 완료]로 전환하여 클릭 시 수정 저장과 함께 수정된 정산 메일이 재발송되도록 통합', '[현재 참석자] 탭 우측 창 상단에 정회원 불러오기·종전 참석자 불러오기·정회원 관리 메뉴를 배치하고, 아래 줄에 현재 참석자 명단(좌)과 전체 비우기(우)를 정렬 배치'] },
        { ver: '1.7.55', date: '2026.11.25', items: ['정산 이력 관리자·사용자 페이지 불일치 및 삭제된 이력(id 누락 좀비 노드) 중복 표시 버그 수정 (extractValidGlobalHistory 공통 정제 및 All balls 잔여 예산 정상화)', '동일 클럽·동일 날짜 선택 시 관리자 DB(globalHistory) 실시간 조회 및 인앱 팝업 모달(중복 정산 날짜 알림) 즉시 표시로 강화', '클럽별 정회원 인원 관리 모달 및 [현재 참석자] 탭 [⭐ 정회원 불러오기] · [📋 종전 참석자 불러오기] · [⚙️ 정회원 관리] 버튼 추가'] },
        { ver: '1.7.54', date: '2026.11.25', items: ['신입사원 명부 등록 후 사라지는 문제 원인 해결: 전사원 명부 전용 모듈(js/directory.js) 분리 및 Firebase 공유 명부(settlements/000000/directory) 전체 덮어쓰기 제거(사원 개별 키 단위 원자적 업데이트 + 정산 확정/수정/삭제 시 원격 최신 스냅샷 병합 후 count/counts 부분 패치)'] },
        { ver: '1.7.53', date: '2026.11.25', items: ['관리자 클럽 관리 테이블 헤더·모달·로그 문구의 "시설 전액"을 "시설 장비"로 변경'] },
        { ver: '1.7.52', date: '2026.11.25', items: ['클럽 관리 및 중간 결산에서 "3M 동탄 운영진"이 필터·정렬 여부와 무관하게 항상 맨 아래에 배치되도록 고정', '중간 결산 팝업 및 엑셀 출력에 정회원·실참석(중복 제외)·비회원 순으로 실참석 컬럼 추가', '중간 결산 팝업 제목줄에 엑셀형 정렬·체크박스 필터 기능 추가 및 필터링된 화면 그대로 엑셀 출력 지원'] },
        { ver: '1.7.51', date: '2026.11.25', items: ['정산 완료 메일 발송 시 제목 형식을 "클럽명, 행사진행한 날짜, 정산 보고서"로 변경 (정산 날짜 선택값 반영)'] },
        { ver: '1.7.50', date: '2026.11.25', items: ['관리자 클럽 관리 패널 폭 확장 및 클럽명 줄바꿈 방지(1행 고정)', '85k·시설 전액 승인 버튼 문구를 "미승인" / "승인"으로 단순화하고 확인 팝업 후 승인 시 파란색 버튼으로 표시되도록 개선'] },
        { ver: '1.7.49', date: '2026.11.25', items: ['코드 안정화 부분 모듈형 구조 적용 (3~4단계): 엑셀·PPT 출력(정산 엑셀 셀 매핑, 연간 결산 PPT, 중간 결산 엑셀)을 js/export-reports.js로, 관리자 클럽 관리(클럽 목록·헤더 필터·클럽 추가/수정)를 js/admin-clubs.js로 분리'] },
        { ver: '1.7.48', date: '2026.11.25', items: ['코드 안정화 부분 모듈형 구조 적용 (1~2단계): 정산 계산·검증 잠금 로직(js/calc-locked.js) 및 대시보드 차트 렌더링 로직(js/charts.js)을 독립 파일로 분리해 타 영역 수정 시 계산식·차트 영향 원천 차단'] },
        { ver: '1.7.47', date: '2026.11.25', items: ['상단에서 클럽을 선택하지 않은 상태("클럽을 선택하세요")에서는 [정산 완료] 및 [정산 확정] 버튼이 자동으로 비활성화(disabled)되도록 개선'] },
        { ver: '1.7.46', date: '2026.11.25', items: ['상단에서 클럽을 선택하지 않은 상태("클럽을 선택하세요")에서는 우측 하단 클럽 잔여 예산·이전 잔여 예산·예산 소진 프로그레스 바가 표시되지 않도록 숨김 처리하고, 클럽 선택 전에는 비용 항목 추가·정산 확정·엑셀 저장 등 비용 처리를 차단하도록 보강'] },
        { ver: '1.7.45', date: '2026.11.25', items: ['로그인 화면 PIN 입력 불능 원인이었던 app.js 요청사항 모달 영역 구문 유실 긴급 복구 및 재발 방지 절대규칙(동일 파일 병렬 edit 금지 · 배포 전 PIN 클릭/키보드 로그인 및 pageerror=0 필수 검수) AGENTS.md 지정'] },
        { ver: '1.7.44', date: '2026.11.25', items: ['관리자 [클럽 관리]에 시설·장비 이용료를 1회에 한해 클럽 잔여(배정) 예산 전액까지 법인카드로 결제하고 초과분은 개인카드로 자동 분배할 수 있는 [🔓 시설 전액 승인] 버튼 추가 (정산 1건 확정 시 자동 미승인 복원)'] },
        { ver: '1.7.43', date: '2026.11.25', items: ['[전사원 명부] 마우스 오버 클럽별 참석 횟수 툴팁 및 상세 팝업 내 우측 횟수("N회") 색상도 라이트/다크 테마 고대비 색상(#0369a1 / #38bdf8)으로 통일 개선'] },
        { ver: '1.7.42', date: '2026.11.25', items: ['[전사원 명부]의 "(올해 누적: N회)" 및 입력 횟수 글자 색상을 라이트/다크 테마 모두에서 선명하게 잘 보이도록 고대비 색상(#0369a1 / #b45309 등)으로 개선'] },
        { ver: '1.7.41', date: '2026.11.25', items: ['관리자 [클럽 관리] 필터·정렬을 별도 상단 바 대신 엑셀(Excel) 스타일 컬럼 제목줄 드롭다운 필터로 개편: [클럽명 / 배정예산 / 상품비 / 잔여 예산] 제목 클릭 시 오름차순·내림차순(높은순·낮은순) 정렬과 항목별 체크박스 다중 선택 필터 팝오버 제공'] },
        { ver: '1.7.40', date: '2026.11.25', items: ['관리자 [클럽 관리]에 클럽 필터(특정 클럽 선택 및 실시간 이름 검색) 및 [클럽명 / 배정예산 / 상품비 / 잔여 예산] 오름차순·내림차순 정렬 기능(상단 정렬 드롭다운 및 테이블 컬럼 헤더 클릭 정렬) 추가'] },
        { ver: '1.7.39', date: '2026.11.25', items: ['관리자 [클럽 관리]에서 추가 배정 또는 금액 수정 시 목록 하단에 중복 클럽 행이 이어 붙어 표시되던 동기적 재진입(Re-entrant DOM 렌더링) 버그 수정: DOM 루프 중 Firebase update 호출을 루프 종료 후 일괄 처리로 분리하고 DocumentFragment 원자적 교체 및 재진입 방지 가드 적용'] },
        { ver: '1.7.38', date: '2026.11.24', items: ['연도별 클럽 목록·배정 예산·총 클럽비용 완전 분리 저장(yearlyClubRegistry/{연도}, yearlyClubTotalBudget/{연도}) 구현 — 다른 연도에서 클럽을 삭제·수정해도 2026년 등 기존 연도 데이터 100% 보존'] },
        { ver: '1.7.37', date: '2026.11.24', items: ['상단 [조회 연도]를 2027년 등 다른 연도로 선택 시 관리자 [클럽 관리] 테이블의 [상품비] 및 [잔여 예산]도 배정 예산은 유지한 채 해당 연도 기준(0원 사용)으로 표시되도록 보강'] },
        { ver: '1.7.36', date: '2026.11.24', items: ['클럽별 정산 이력 [총 자부담 비용] 카드에 총 비용 대비 자부담 비중(%) 함께 표시', '[전사원 명부] 회원 이름에 마우스를 올리면 즉시 클럽별 참석 횟수가 툴팁으로 표시되도록 개선 (모바일 터치 시 팝업 지원)', '상단 [조회 연도]를 2027년 등 신규 연도로 변경 시 전사원 명부 누적·클럽별 정산 이력·잔여 예산·누적 지원금이 해당 연도 기준(0부터)으로 분리 표시되도록 개선'] },
        { ver: '1.7.35', date: '2026.11.24', items: ['로그인 화면 키패드/숫자키 미작동 원인이었던 app.js 구문 누락 긴급 복구'] },
        { ver: '1.7.34', date: '2026.11.24', items: ['[전사원 명부]에서 회원 이름을 클릭하면 올해 어느 클럽에 몇 번·언제 참석했는지 한눈에 확인하는 팝업창 추가'] },
        { ver: '1.7.33', date: '2026.11.24', items: ['상단 [조회 연도] 선택과 [정산 구간 및 비율 설정] 및 [연간 결산 PPT]를 1:1로 자동 연동 (조회 연도 변경 시 해당 연도의 구간·비율 설정값 자동 불러오기·저장 및 PPT 기준표 반영)'] },
        { ver: '1.7.32', date: '2026.11.24', items: ['정산 구간·비율·한도를 연도별로 분리 관리(globalSettings/yearlyRules/{연도})할 수 있도록 관리자 설정에 연도 선택 기능 추가', '연간 결산 PPT 보고서 생성 시 해당 연도의 정산 구간 및 한도 기준표 슬라이드를 자동 포함하도록 개선'] },
        { ver: '1.7.31', date: '2026.11.24', items: ['[📋 중간 결산] 팝업 표 및 엑셀 다운로드의 [소진율]을 소수점 첫째 자리(예: 63.2%, 100.0%)까지 표시하도록 개선'] },
        { ver: '1.7.30', date: '2026.11.24', items: ['비용 항목 [내역 (항목명)] 입력란에 한글 입력 우선 속성(lang="ko", inputmode="text", ime-mode: active) 적용'] },
        { ver: '1.7.29', date: '2026.11.24', items: ['정산 완료 메일 발송 시 정산서 엑셀 파일(.xlsx, 내부에 행사·영수증 사진 포함)만 첨부하고 별도 이미지 파일 중복 첨부를 제거해 발송 속도 및 메일함 용량 최적화'] },
        { ver: '1.7.28', date: '2026.11.24', items: ['로그인 인증 직후 globalSettings(메일 웹훅 URL·정산 규칙·비고 항목) 실시간 리스너 재연결 및 발송 시점 직접 조회 보강으로 첨부 메일 미발송 원인 해결'] },
        { ver: '1.7.27', date: '2026.11.24', items: ['정산 완료 시 Google Apps Script 연동을 통해 정산서 엑셀(.xlsx) 및 영수증/행사 사진이 이메일에 실제 파일로 자동 첨부·발송되도록 기능 추가 (관리자 페이지 웹 앱 URL 1회 등록)'] },
        { ver: '1.7.26', date: '2026.11.24', items: ['[📋 중간 결산] 엑셀 다운로드 시 전체 표 테마 디자인(제목 배너, 헤더, 테두리, 천 단위/퍼센트 서식, 총합계·연구소 예산 행) 및 100% 소진 클럽 강조 색상(노란 행 + 진녹색 소진율 배지) 적용'] },
        { ver: '1.7.25', date: '2026.11.24', items: ['기존 회원의 정산 수신 이메일(이현준 hjlee@mmm.com 등)을 회원 목록 및 수정 화면에 자동 동기화하고 구버전 기본값(finance@club.com) 제외 처리'] },
        { ver: '1.7.24', date: '2026.11.24', items: ['정산 및 발송 설정 등에서 회사 이메일을 등록·수정한 회원의 경우 관리자 [회원 정보 수정] 모달 및 회원 목록에 등록된 이메일이 자동 표시되고 수정 가능하도록 동기화 보강'] },
        { ver: '1.7.23', date: '2026.11.24', items: ['관리자 페이지 상단 요약 카드 4종 구성을 [총 등록 클럽 / 클럽 총 예산 / 전체 누적 지원금 / 잔여 금액]으로 개편'] },
        { ver: '1.7.22', date: '2026.11.24', items: ['관리자 페이지의 [📋 중간 취합표] 버튼 및 관련 표기(안내 문구, 엑셀 시트·파일명)를 [📋 중간 결산]으로 변경'] },
        { ver: '1.7.21', date: '2026.11.24', items: ['전체 코드 정밀 점검 및 안정화: 정산 확정·이력 수정 시 공유 전사원 명부(settlements/000000/directory) 누적 횟수 실시간 재계산 보강, 수정 모드 엑셀 다운로드 시 비회원 수·비고·정산일 동기화, 정산 초기화 시 영수증 썸네일 클린업 및 중간 취합표 실시간 최신 이력 조회 보강'] },
        { ver: '1.7.20', date: '2026.11.24', items: ['사용자 [정산 이력] 탭에서도 정산 이력을 직접 삭제할 수 있도록 권한 확대 (삭제 시 감사 로그 자동 기록 및 클럽 예산·참석 횟수 동시 차감)', '비용 항목 입력 시 법인카드/개인카드 영수증 첨부 우측에 긴 안내 문구 대신 작은 영수증 썸네일 이미지가 표시되도록 개선 (클릭 시 확대 보기)'] },
        { ver: '1.7.19', date: '2026.11.24', items: ['[📋 중간 취합표] 100% 소진 클럽 상단 배치 및 소진율 높은 순 자동 정렬 적용, 하단 [연구소 예산 잔액] 우측 불필요한 설명 문구 제거'] },
        { ver: '1.7.18', date: '2026.11.24', items: ['[📋 중간 취합표] 하단에 [연구소 총 예산] 및 [연구소 예산 잔액] 행 추가 (엑셀 다운로드 동시 반영) 및 [잔여금액] 텍스트 색상을 눈이 편안한 차분한 톤으로 개선'] },
        { ver: '1.7.17', date: '2026.11.24', items: ['[📋 중간 취합표] 상단 타이틀 및 엑셀 첫 행에 조회 기간(예: 2026년 1월 ~ 현재 날짜 진행 내역)이 자동 표시되도록 개선'] },
        { ver: '1.7.16', date: '2026.11.24', items: ['관리자 [📋 중간 취합표] 팝업 PC 전체 화면 높이 최적화(잘림 없이 전 클럽 및 총합계 한눈에 표시) 및 [지원금]과 [행사수] 사이에 [잔여금액] 컬럼 추가 (엑셀 다운로드 동시 반영)'] },
        { ver: '1.7.15', date: '2026.11.24', items: ['정회원·비회원 참석자 수 라벨에서 불필요한 [(명)] 표기 제거', '관리자 대시보드에 [📋 중간 취합표] 팝업 및 엑셀(.xlsx) 다운로드 기능 신설: 클럽별 예산·지원금·행사수·정회원·비회원·예산비율·인원비율·소진율·인당지원금·평균참여인원·비고(온라인/가족행사 자동 카운트) 및 총합계 자동 집계'] },
        { ver: '1.7.14', date: '2026.11.24', items: ['정산 입력 화면 [참석자 및 기존 누적 정보] 카드 개편: 좌측 [정회원 참석자 수(자동 반영)] / 우측 [비회원 참석자 수(수동 기입, 정산 금액 미반영)] 2열 분리 및 [비고(온라인·가족 행사·새 항목 추가)] 드롭다운 신설'] },
        { ver: '1.7.13', date: '2026.11.24', items: ['관리자 [가입 회원 관리 > 수정] 모달에서 회원의 회사 이메일(@mmm.com) 수정 기능 추가 (정산 수신 메일 자동 동기화 포함)'] },
        { ver: '1.7.12', date: '2026.11.24', items: ['상단 [+ 새 클럽 직접 등록] 입력창에 [취소] 버튼 및 Esc 닫기 지원 추가 (등록을 취소하고 기존 클럽 선택 화면으로 즉시 복귀 가능)'] },
        { ver: '1.7.11', date: '2026.11.24', items: ['신규 회원 가입 시 입력한 회사 이메일(@mmm.com)이 [정산 및 발송 설정 > 회사 이메일 주소 (받는 사람)]에 즉시 자동 저장·연동되도록 보강 (재로그인 시에도 자동 유지)'] },
        { ver: '1.7.10', date: '2026.11.24', items: ['신규 회원 등록 기입 항목을 [이름 / PIN 번호 / 회사 이메일(@mmm.com)] 3가지로 정돈 (연락처 입력란 제거)'] },
        { ver: '1.7.9', date: '2026.11.24', items: ['신규 회원 가입 화면에 [연락처] 및 [@mmm.com 고정 회사 이메일] 입력란 추가 (가입 시 정산 수신 메일 자동 연동 및 관리자 회원 목록에 연락처·이메일 표시)'] },
        { ver: '1.7.8', date: '2026.11.23', items: ['[현재 참석자] 탭 버튼 명칭을 [📋 종전 참석자 불러오기]로 변경하고, 버튼 클릭 시 별도 팝업 없이 가장 최근 정산 참석자 명단이 아래 [현재 참석자 명단]에 즉시 일괄 추가되도록 개선'] },
        { ver: '1.7.7', date: '2026.11.23', items: ['[현재 참석자] 탭에 [📋 이전 참석자 불러오기] 기능 추가: 선택한 클럽의 최근 정산 참석자 명단을 체크박스로 한 번에 불러온 뒤 일부 인원만 손쉽게 추가·수정·삭제 가능 (중복 인원 자동 제외)'] },
        { ver: '1.7.6', date: '2026.11.23', items: ['연간 결산 PPT 보고서 클럽별 상세 슬라이드(5p~) 참석자 명단 카드 개선: 행사 표 높이와 참석 인원 수에 맞춰 글자 크기·줄간격을 자동 조절하고, 공간이 부족할 경우 별도 명단 슬라이드로 자동 분리하여 글자 겹침 및 칸 이탈 현상 해결'] },
        { ver: '1.7.5', date: '2026.11.23', items: ['관리자 대시보드 상단 요약 지표 개편: [👥 총 등록 가입자] 카드를 [🏢 총 등록 클럽] 수 표시로 변경'] },
        { ver: '1.7.4', date: '2026.11.23', items: ['관리자 차트 [자부담 / 회사지원금 추이]에 총 자부담 비용 및 총 회사 지원금의 비중(%) 표시 추가 (상단 누적 요약 카드 및 월별 그래프 툴팁 동시 반영)'] },
        { ver: '1.7.3', date: '2026.11.23', items: ['정산 완료 확인 팝업 문구 및 버튼 간소화: 수신 메일, 디바이스 저장(활성화/비활성화), 정산 완료 확인 시 현재 화면 초기화 안내만 깔끔하게 표시되도록 개선'] },
        { ver: '1.7.2', date: '2026.11.23', items: ['정산 날짜 선택 달력 UI 및 휴일 표시 개선: 실제 달력과 동일하게 일요일이 맨 왼쪽에서 시작해 일~토요일 순으로 정렬되도록 고정하고, 일요일 및 법정 공휴일·대체공휴일은 빨간색(휴일명 표시), 토요일은 파란색으로 명확히 구분 표시', '정산 날짜 선택 버튼에 선택한 날짜의 요일 및 공휴일명(예: (일요일), (목요일 · 광복절))이 해당 요일 색상과 함께 직관적으로 표시되도록 개선'] },
        { ver: '1.7.1', date: '2026.11.12', items: ['관리자 전용 비밀번호(000000) 접속 폐지 및 역할 기반(회장·개발자·추가 관리자) 권한 체계 도입: 본인 PIN으로 로그인 시 사용자 페이지로 우선 접속되며, 관리자 권한 보유자에게만 상단 [👑 관리자 페이지] ↔ [👤 사용자 페이지] 전환 버튼 표시', '초기 관리자 권한 지정(회장: 이현준 003645, 개발자: 김종필 002531) 및 관리자 페이지 [가입 회원 관리]에서 회장/개발자 변경 및 추가 관리자 권한 실시간 부여·해제 기능 탑재'] },
        { ver: '1.7.0', date: '2026.11.11', items: ['3M 사내 클럽 비용 정산기 v1.7.0 정식 최종 배포: 모바일 전용 사용자 매뉴얼 & PC 전용 관리자 매뉴얼 분리 완성, 전사원 명부 실시간(Realtime) 동기화 & 👑 최다 참석 1위 왕관 배지, 정산 결과 총 자부담 자동 일원화 및 사규 최소 기준 미달 방지, 전체 작업 로그 최적화 등 모든 핵심 기능 안정화 및 정식 릴리즈'] },
        { ver: '1.6.362', date: '2026.11.10', items: ['사용자 매뉴얼과 관리자 매뉴얼 분리 발간: 100% 모바일 스마트폰 전용 화면으로 구성된 "사용자 매뉴얼(모바일).pptx"와 100% PC 와이드 대화면으로 구성된 "관리자 매뉴얼(PC).pptx" 2종 개별 파워포인트 빌드 및 제공'] },
        { ver: '1.6.361', date: '2026.11.10', items: ['실무 설명회 발표자료(PPTX) 및 정산 기준·사용법 모달 최신화 완료: 전사원 명부 👑 최다 참석 1위 왕관 배지, 실시간 동기화 & 사번 기반 일원화, 정산 결과창 총 자부담 수정불가 전환 및 비용 항목별 직접 입력 일원화, 사규 최소 기준 미달 방지 안내, 전체 작업 로그 최적화 내역 전면 반영 및 최신 PPTX 재생성'] },
        { ver: '1.6.360', date: '2026.11.10', items: ['사원 등록 폼에서 동명이인 부서명 기입 안내 문구("동일한 이름이 존재합니다. 이름뒤에 (부서명)을 적어주세요.") 전면 제거: 사번(EMP ID) 기반 동명이인 구분 시스템 일원화'] },
        { ver: '1.6.359', date: '2026.11.10', items: ['전사원 명부 실시간(Realtime) 양방향 동기화 리스너 도입: 관리자 또는 사용자가 신규 사원(예: 김민준 02256781)을 등록/수정/삭제 시 다른 모든 접속자 화면에서 새로고침 없이 즉시 실시간 검색 및 자동완성 반영'] },
        { ver: '1.6.358', date: '2026.11.10', items: ['전사원 명부 관리자/사용자 페이지 인원수 및 명부 불일치 전면 해결: 일반 사용자 로그인 시 관리자(000000) 명부를 공통 기준으로 일원화 동기화, 사원 등록/삭제 시 관리자 명부 실시간 원자적(atomic) 동기화 반영, 기존 계정 명부 데이터 1,315명 통일 마이그레이션'] },
        { ver: '1.6.357', date: '2026.11.10', items: ['전사원 명부 및 참석자 목록 최다 참석 1위 사원 왕관(👑) 표기 및 하이라이트 추가: 최다 참석자 이름 앞 왕관 배지, 👑 1위 배지 및 골드빛 카드 강조 효과 적용 (공동 1등 모두 지원)'] },
        { ver: '1.6.356', date: '2026.11.10', items: ['전체 작업 로그에서 "현재 정산 내용 초기화" 기록 제외: 정산 화면 초기화 시 감사 로그 저장 중단 및 기존 저장된 정산 초기화 로그 목록 숨김 필터링 적용'] },
        { ver: '1.6.355', date: '2026.11.10', items: ['비용 항목 재클릭 시 수정 모드 입력값 보존 버그 해결: 기존에 사용자가 직접 수정한 법인카드/개인카드 및 1인당 자부담 분할값이 기본 자동계산값으로 덮어씌워지던 문제 수정 및 저장값 완전 보존'] },
        { ver: '1.6.354', date: '2026.11.10', items: ['스크립트 런타임 구문 정상화 및 로그인 PIN 키패드 입력 동작 복원'] },
        { ver: '1.6.353', date: '2026.11.10', items: ['정산 결과 화면의 "총 자부담 금액 (수정 가능)"에서 "(수정 가능)" 문구 삭제 및 결과 표시 전용(수정 불가)으로 전환: 자부담 금액 조정은 비용 항목 추가/수정 폼(좌측)의 1인당 자부담 및 카드 분할을 통해서만 진행되도록 일원화'] },
        { ver: '1.6.352', date: '2026.11.10', items: ['사규 최소 기준 자부담 이하 입력 원천 차단 및 실시간 사유 안내: 1인당 자부담 입력란 및 정산 결과의 총 자부담란에서 사규 규정(나 구간 20%, 다 구간 초과 40% 누진 등) 최소 금액보다 낮은 금액 입력 시 즉각적인 사규 위반 사유 표시 및 최소 기준값 자동 복원 적용'] },
        { ver: '1.6.351', date: '2026.11.10', items: ['정산 결과 화면의 "인당 자부담 비용" 표시 정합성 개선: 실제 총 자부담 금액을 참석 인원수로 나눈 실제 1인당 자부담(예: 36,000원÷3명=12,000원)이 정확하게 일치 표시되도록 수정하고, 사규 최소 기준값과의 차이가 있는 경우 보조 안내 라벨로 함께 표시', '비용 항목 추가 시 하단 실시간 프리뷰 배너의 라벨을 "(개인부담)"에서 "(1인당 자부담)"으로 명확화하여 개별 항목 개인카드 금액과의 혼동 해소'] },
        { ver: '1.6.350', date: '2026.11.10', items: ['정산 기준 안내 모달 예시 항목 슬림화: 중복되거나 불필요한 예시를 정돈하여 핵심 경계값(30,001원 / 60,001원·120,000원 / 120,001원)만 명확하게 제시하고 스크롤 부담 완화', '실무 설명회 발표 자료(PPTX) 정산 기준 안내 슬림 팝업 및 최신 스크린샷 동기화'] },
        { ver: '1.6.349', date: '2026.11.10', items: ['정산 기준 안내 모달 상세 설명 및 경계값 예시 보강: 30,001원(나 구간 진입 시 전체 20% 적용으로 6,000원 자부담), 60,001원(다 구간 초과분 40% 누진으로 12,000원 동일), 120,001원(라 구간 최대 85,000원 정액 지원 전환으로 35,001원 자부담) 사규 공식 원리 및 구체적 계산 예시 추가'] },
        { ver: '1.6.348', date: '2026.11.10', items: ['전사원 명부 와이드 데스크톱(≥1200px/1600px) 레이아웃 전면 개편: 차트 탭 규격에 맞춰 전폭(최대 1840px) 확장 및 좌측 사원 등록(360px 고정·sticky) / 우측 명부 목록(3~4열 멀티 컬럼 그리드) 1:4 최적 비율 적용', '명부 스크롤 높이 대폭 확장(calc(100vh - 260px), 최소 580~640px): 큰 화면에서 스크롤 없이 한 번에 20~30명 이상의 사원을 시원하게 조망 가능'] },
        { ver: '1.6.347', date: '2026.11.09', items: ['연간 결산 PPT 우수 클럽 랭킹 기준 개편: "안정적 예산 운용 클럽"을 "알뜰 예산 운용 클럽"으로 명칭 변경하고, 산출 기준을 기존 85% 근접에서 "배정 예산 내 100% 소진(100% 이하 최다 소진, 불용 예산 최소화)"으로 개선', '설명회 발표 자료(PPTX)에 나노바나나 클라우드 아키텍처(전용 구글 계정·Firebase 실시간 DB·자동 메일 발송) 인포그래픽 및 설명 보강'] },
        { ver: '1.6.346', date: '2026.11.09', items: ['전체 작업 로그 기록 범위 최적화: 정산 작성 과정의 임시 작업(비용 항목·참석자·영수증·사진의 개별 추가/삭제/초기화)에 대한 불필요한 과다 로그를 제거하고, "정산 확정 완료" 및 "정산 이력 수정" 시점에만 큰 틀로 명확히 기록되도록 개편', '관리자 화면에서의 마스터 데이터(클럽 관리·회원 관리·정산 규칙·전사원 명부·이력 삭제)에 대한 추가/수정/삭제 기록은 기존대로 철저하게 유지'] },
        { ver: '1.6.345', date: '2026.11.09', items: ['정산 기준 안내 모달 색상 및 가독성 전면 개선: 라이트/다크 테마별 고대비 텍스트 색상과 화이트 카드 배경을 적용하여 흐릿하게 보이던 텍스트 및 예시 박스를 선명하게 보정'] },
        { ver: '1.6.344', date: '2026.11.09', items: ['비용 항목 추가 금액 입력란에 "❓ 정산 기준" 안내 버튼 및 상세 설명 팝업 추가', '관리자가 정산 구간·비율 수정 시 실시간으로 연동되는 가/나/다/라 구간별 계산 공식 및 구체적 금액 예시 제공 (다 구간 초과 누진 계산 원리 안내)'] },
        { ver: '1.6.343', date: '2026.11.09', items: ['전사원 명부 실시간 검색 기능 추가: 검색창에 한 글자(예: "김") 또는 두 글자 이상(예: "김종") 입력 시 즉시 해당 이름 및 사번과 일치하는 항목만 실시간 필터링', '검색어 일치 건수/전체 인원 분수 표시 및 원터치 검색어 지우기(×) 버튼 지원'] },
        { ver: '1.6.342', date: '2026.11.09', items: ['클럽별 정산이력 폰트 및 숫자 크기 최적화: 상단 7개 요약 타일과 정산 테이블(10개 컬럼)의 글씨·금액 숫자를 컴팩트하게 축소하여 어떤 해상도에서도 짤림 없이 한눈에 표시되도록 개선'] },
        { ver: '1.6.341', date: '2026.11.09', items: ['전사원 명부 탭 좌측 패널 명칭 변경: "전사원 등록" ➔ "사원 등록"으로 간소화', '우측 명부 리스트 UI 개선: 우측 개별 "추가" 버튼 제거 및 24시간 동안 유지되는 "✨ 신규 등록" 배지 도입'] },
        { ver: '1.6.340', date: '2026.11.09', items: ['클럽 사용 요약 상단 지표 수정: "총 참석 인원"을 정산 건당 "평균 참석 인원"으로 변경(소수 첫째자리 지원)', '클럽별 정산이력 UI 정돈: 개별 클럽 헤더의 상세/요일 버튼을 제거하고 우측 상단 필터바의 전체 일괄 변경 버튼으로 통일'] },
        { ver: '1.6.339', date: '2026.11.06', items: ['클럽별 정산이력 클럽 선택 드롭다운 추가: 전체 클럽(2x2 그리드)과 특정 클럽 단독 전폭(100%) 뷰 지원', '모바일 최적화 클럽별 요일별 요약 버전 추가: 7개 요일별(월~일) 정산 건수·비율 게이지, 최다 활동 요일 배너, 주중/주말 활동 통계, 요일별 행사 내역 아코디언 제공', '정산이력 탭 상단 필터바 및 개별 클럽 카드별 [📋 상세 내역] / [📅 요일별 요약] 원터치 전환 토글 지원'] },
        { ver: '1.6.338', date: '2026.11.06', items: ['와이드 레이아웃 적용 범위 확대: 1920 해상도의 다양한 배율(100%, 125%=1536px, 150%=1280px)을 위해 브레이크포인트를 min-width: 1200px로 최적화', '대시보드 관리 좌측 열 여백 최소화: "무엇부터 할까요?" 가이드 바로 밑에 "정산 구간 및 비율 설정" 카드가 10px 간격으로 바짝 밀착되도록 여백 완전 축소'] },
        { ver: '1.6.337', date: '2026.11.06', items: ['대시보드 관리(관리자 모드) 2열 독립 컬럼 구조 전면 개편: 좌측(시작 가이드 바로 밑에 정산 구간·비율 설정 빈틈없이 밀착), 우측(클럽 관리 전체 클럽 및 가입 회원 관리 전체 목록 스크롤 자름 없이 전부 노출)', '카드 접기 연동 개선: 접기 버튼 클릭 시 펼쳐진 내용이 접히고 아래 카드가 위로 즉각 밀착되어 여백 없이 화면에 맞춤 정렬'] },
        { ver: '1.6.336', date: '2026.11.06', items: ['클럽별 정산이력 4분할 뷰 개편: 좌상/우상/좌하/우하 2x2 그리드로 4개 클럽이 한 화면에 배치되고 전체 10개 컬럼(날짜·인원·비용·지원금·자부담·엑셀·삭제)이 온전히 가로 표로 표시되도록 최적화 (스크롤 시 추가 클럽 확인)', '대시보드 관리(관리자 모드) 좌우 2분할 와이드 레이아웃 적용: 좌측(시작 가이드 + 정산 기준 설정), 우측(클럽 관리 + 회원 관리)으로 한눈에 조망 가능'] },
        { ver: '1.6.335', date: '2026.11.06', items: ['와이드 화면(1920x1080/1280) 대응: 차트 탭 선택 시 모든 차트(월별 지출, 소진율, 카테고리 비중, 정산 횟수, 실참석 인원, 자부담 추이, 최근 알림)가 스크롤 없이 한눈에 파노라마 전개', '클럽별 예산 소진율 모션 원형 링 게이지 개편: 클럽 고유 색상 링 + 위험도 % 텍스트 + 진입 애니메이션', '카테고리 도넛 차트 중앙 총 비용 표시 및 KPI 카드 카운트업 모션 적용'] },
        { ver: '1.6.334', date: '2026.10.22', items: ['이전 전체 작업 로그 DB 초기화 완료 및 전체 작업 로그 모달에 관리자 전용 [ 🗑️ 로그 비우기 ] 기능 탑재', '앞으로 수정·입력·삭제되는 모든 작업 데이터가 최신순으로 정확히 누적 기록되도록 보장'] },
        { ver: '1.6.333', date: '2026.10.22', items: ['감사 로그(작업 기록) 조회 시 Firebase DataSnapshot 순회 중단 버그 수정 (화살표 함수의 push 반환값으로 인한 조기 break 방지)', '클럽 예산 수정 등 최신 작업 이력이 관리자 감사 로그 모달에 정상적으로 누적·표시되도록 개선'] },
        { ver: '1.6.332', date: '2026.10.22', items: ['정산 이력(사용자) 및 클럽별 정산이력(관리자) 탭 헤더의 중복 조회 연도 드롭다운 제거 및 상단 [ 2026 ▾ ] 전역 연도 선택기로 일원화', '상단 조회 연도 변경 시 대시보드 차트뿐만 아니라 관리자 클럽별 정산이력 및 사용자 정산이력까지 해당 연도로 즉시 동기화'] },
        { ver: '1.6.331', date: '2026.10.22', items: ['클럽 운영 대시보드 헤더의 중복 테마 설정(Dark/Light) 삭제 및 상단 글로벌 헤더 테마 컨트롤로 일원화', '조회 연도 선택 위치를 3M 클럽 비용 정산 상단으로 이동하고 [ 2026 ▾ ] 버튼 형태 UI 적용', '조회 연도 버튼 클릭 시 현재 DB에 등록된 연도 목록 및 건수가 표시되는 팝업창 모달 연동, 연도 클릭 시 해당 연도 정산 데이터 실시간 조회'] },
        { ver: '1.6.328', date: '2026.10.22', items: ['실 참석 인원 카드 헤더의 3M 애니메이션 위젯 크기 대형화(185px x 88px) 및 대형 단체 모임 씬 전면 반영: 헤더의 상·하 여백을 시원하게 채우는 와이드 프레임과 함께 사방에서 수십 명의 동료들이 모여 3M을 환호하는 전체 씬을 꽉 차게 렌더링'] },
        { ver: '1.6.327', date: '2026.10.22', items: ['실 참석 인원 카드 헤더의 3M 팀워크 애니메이션 클로즈업 줌인 반영: 3M 로고 피켓과 주인공 그룹을 중심으로 위아래·좌우 여백을 바짝 크롭하여 위젯 창 내에 캐릭터가 꽉 차도록 확대(Zoom In) 적용', '위젯 창 크기를 데스크톱 135px x 60px(모바일 96px x 44px)로 최적화하여 3M 캐릭터와 로고 시인성 극대화'] },
        { ver: '1.6.326', date: '2026.10.22', items: ['실 참석 인원 카드 헤더의 3M 애니메이션 GIF 위아래 여백 크롭 및 와이드 확대: 불필요한 상·하단 빈 배경을 걷어내어 캐릭터를 1.5배 이상 크게 부각하고, 헤더 위젯 크기를 145px x 52px(모바일 106px x 38px) 파노라마 뷰로 대폭 확장'] },
        { ver: '1.6.325', date: '2026.10.21', items: ['실 참석 인원 카드 헤더 위젯 UI 간소화: 우수 클럽 순위 및 실참석 카운터 텍스트를 제거하고 3M 팀워크 모임 애니메이션 GIF 단독 뷰로 정돈', '카드 헤더 높이 및 여백에 최적화된 프레임 사이즈(46px x 82px)와 부드러운 스케일업 호버 인터랙션 적용'] },
        { ver: '1.6.324', date: '2026.10.21', items: ['실 참석 인원 카드 헤더에 3M 팀워크 모임 애니메이션 GIF(280x158 최적화 버전) 전면 반영: 3M 로고를 중심으로 동료들이 사방에서 뛰어와 모여드는 고화질 2D 카툰 애니메이션을 헤더 위젯에 연동', '1위·2위·3위 우수 클럽 전환 시 애니메이션 GIF와 함께 클럽명 뱃지 및 실 참석자 수가 부드럽게 갱신되고 클릭 시 명단 모달이 즉시 열리도록 최적화'] },
        { ver: '1.6.323', date: '2026.10.21', items: ['클럽별 예산 소진율 차트 간헐적 미표시 버그 전면 해결: 클럽 레지스트리 비동기 로딩 지연 시 이력 데이터 기반 클럽 자동 폴백 보강, 미등록/속성 누락 클럽 안전 가드 및 가로 막대 차트 플러그인의 함수형 배경색 파싱 예외 원천 차단', '실 참석 인원 카드 헤더의 10인 모임 만화 애니메이션 전면 개편: 게이지 슬롯 채우기 방식에서 캐릭터들이 실제로 통통 걸어와 행사장(축제 텐트)으로 모이는 역동적인 걷기·모임 만화 씬으로 재작업', '비용 항목 추가 시 "이번 금액 반영 시" 배너의 개인부담금 입력란 줄바꿈 배치: "이번 금액 반영 시: 총 자부담 XX원" 아래 줄로 "(개인부담 [ 11,000 ] 원 ↺ 자동값)"이 단정하게 배치되도록 개행 분리'] },
        { ver: '1.6.322', date: '2026.10.21', items: ['비용 항목 추가 시 "이번 금액 반영 시" 배너의 개인부담금 직접 입력 기능 탑재: 원하는 인당 금액(11,000원, 15,000원 등)을 입력하면 전체 인원수 및 기존 개인카드 금액을 자동 역산하여 법인카드와 개인카드 입력란에 딱 떨어지게 자동 분할 배분', '클럽별 참석 인원 차트 전체 너비(100%) 원상 복원 및 카드 제목줄 우측 빈 공간에 "클럽 행사 10인 모임 만화 애니메이션" 신설: 1위·2위·3위 우수 클럽 배너와 함께 캐릭터들이 1명부터 10명까지 신나게 걸어와 모이고 10명이 모이면 축하 후 반복되는 귀여운 만화 스타일 애니메이션 탑재'] },
        { ver: '1.6.321', date: '2026.10.21', items: ['"고유" 참석자 표기를 "실" 참석자로 직관적 통일 (중복을 제외한 실 참석자 수, 실 참석자 명단)', '실 참석 인원 차트 우측에 "실 참석 우수 클럽 TOP 3 그룹 10인 모임 달성 애니메이션" 신설: 1위·2위·3위 클럽별로 1명부터 10명까지 점진적으로 팀원이 모이고 완료 시 축하 후 다시 반복되는 인터랙티브 라이브 애니메이션 위젯 탑재', '클럽별 정산 횟수 및 예산 소진율 차트 막대 클릭 시 해당 클럽 사용 요약 팝업이 뜨지 않던 연도 변수 참조 버그 수정'] },
        { ver: '1.6.320', date: '2026.10.21', items: ['연도별 정산 자료 조회 기능 신설: 클럽별 정산 이력·개인 이력·대시보드 통계/차트에서 2026년, 2027년 등 연도별 과거 정산 내역 및 전체 누적을 손쉽게 선택 조회할 수 있는 연도 선택 드롭다운 추가', '정산 규칙(rules) 연도별 스냅샷 영구 보존 및 격리: 정산 확정 시 당시 적용된 지원 구간 및 비율을 이력에 영구 박제하여, 새해에 규칙이 변경되더라도 과거 연도(2026년 등)의 정산 결과 및 엑셀 재다운로드는 당시 기준 그대로 고정 보존되고 새해 시작 정산 건만 변경된 규칙으로 안전하게 적용되도록 격리'] },
        { ver: '1.6.319', date: '2026.10.21', items: ['정산 화면 하단 클럽 예산 프로그레스 바 그래프를 작성 중 실시간 반영에서 "정산 완료 버튼 클릭 후 DB 확정 시" 반영되도록 개선 (현재 확정 저장된 사용액/잔여액 기준 고정)', '상품비 표시 순서 개편: 위쪽 입력란에 "올해 상품비 잔여 한도", 아래쪽 힌트에 "기존 상품비 누적액"이 명확하게 분리 표시되도록 UI 일체화'] },
        { ver: '1.6.318', date: '2026.10.21', items: ['클럽 관리 화면에서 "중복 클럽 정리" 버튼 제거', '전체 작업 로그(Audit Log) 대상 명확화 및 전면 개편: 정산 수정, 추가 배정, 85k 승인, 금액 수정(총 예산/클럽 배정예산), 신규 가입, 회원 삭제, 회원 정보 수정, 정산 구간 변경, 전사원 명부 변경(등록/수정/삭제/카운트) 등 핵심 작업 로그 기록 및 모달 내 항목 구분 필터 신설'] },
        { ver: '1.6.317', date: '2026.10.21', items: ['클럽 관리 목록의 "차트 색상" 네모박스와 글씨를 제거하고 클럽명 텍스트 자체에 지정된 고유 색상을 직접 적용', '클럽명 클릭 시 즉시 차트 색상을 변경할 수 있는 인라인 색상 피커(Color Picker) 대화상자 연동'] },
        { ver: '1.6.316', date: '2026.10.21', items: ['사용자 정산 화면 하단에 클럽 총 예산, 사용률(%), 사용 금액 및 잔여 예산을 한눈에 직관적으로 보여주는 가로 프로그레스 바 그래프 신설', '비용 항목 및 자부담 변동 시 기존 사용액과 이번 정산 지원금 누적 소진율을 2단 스택으로 실시간 시각화 반영'] },
        { ver: '1.6.315', date: '2026.10.21', items: ['클럽 관리에서 "올해 기존 사용" 항목 완전 삭제 (클럽 등록 폼 입력칸·힌트 및 리스트 내 인라인 입력 필드 제거)', '클럽 목록 상단에 타이틀 라인 헤더(클럽명, 배정예산, 상품비(한도 50만원), 잔여 예산, 추가 배정, 85k, 관리) 신설', '클럽 목록 각 행의 중복 라벨을 제거하고 금액만 깔끔하게 직관적으로 표시되도록 일체형 그리드 테이블 레이아웃 적용'] },
        { ver: '1.6.314', date: '2026.10.20', items: ['비용 정산 확정/발송 시 관리자 DB(globalHistory)를 실시간 조회하여 동일 클럽·동일 날짜 중복 정산 방지 및 안내 팝업 기능 추가'] },
        { ver: '1.6.313', date: '2026.10.20', items: ['비용 항목 추가/수정 실시간 프리뷰 배너("이번 금액 반영 시") 하단에 예상 총 자부담 비율(%) 실시간 표시 추가'] },
        { ver: '1.6.312', date: '2026.10.20', items: ['정산 결과 카드 내 정산 날짜 라벨 문구를 직관적인 "📅 정산 날짜 (변경 가능)"으로 간소화 및 레이아웃 정리'] },
        { ver: '1.6.311', date: '2026.10.20', items: ['연간 결산 보고서 PPT(3p) 클럽별 소진율 그래프 내부 퍼센테이지(%) 텍스트 박스 너비 확장 및 margin:0, wrap:false 강제 적용으로 소수점/퍼센트 줄바꿈(100. 0% 등) 완벽 해결', '시스템 사용자 설명회 발표자료(PPTX)를 고품격 엔터프라이즈 라이트 테마로 전면 개편', '설명회 PPT 전 슬라이드의 글자 크기, 행 높이(lineSpacing), 들여쓰기, 카드 여백을 최적화하여 텍스트 겹침·잘림·답답함 완전 해소'] },
        { ver: '1.6.310', date: '2026.10.20', items: ['[버그 해결] 차트 탭 그래프 캔버스가 간헐적으로 빈 화면으로 렌더링되지 않던 근본 원인 수정: index.html 내 누락되었던 Chart.js 라이브러리(./lib/chart.min.js) 스크립트 태그 복원', 'Chart.js 라이브러리 초기화 지연 시에도 누락 없이 100% 렌더링되도록 자동 재시도(Auto-retry) 안전장치 탑재'] },
        { ver: '1.6.309', date: '2026.10.20', items: ['연간 결산 PPT 클럽별 예산 소진율 그래프(3p) 원래 2단 레이아웃(막대/퍼센트 + 사용금액/잔여 + 배정금액) 완벽 복원 및 각 클럽별 고유 지정 색상(그래프 막대 및 좌측 클럽명 글자색) 적용', '소진율 막대그래프의 모든 텍스트(클럽명·배정금액·사용금액·퍼센트)를 PPT 독립 텍스트 상자로 배치하여 슬라이드 위에서 직접 타이핑 수정 가능하게 최적화', '클럽별 상세 활동 슬라이드(5p+) 상단 메타 박스 줄바꿈 배치: "연간 예산 · 총 집행액 · 상품비" 1줄, "참석 실인원" 2줄로 분리하여 끝자리 금액 잘림 현상 완전 해소', '관리자 모드 헤더 내 중복되던 기존 테마 토글 버튼 제거 (최상단 헤더의 상시 테마 토글 버튼으로 깔끔하게 일원화)'] },
        { ver: '1.6.308', date: '2026.10.20', items: ['연간 결산 PPT 소진율 막대 차트(3p) 전면 개편: Office 통합 차트 대신 슬라이드 상에서 즉시 클릭·수정 가능한 독립 텍스트 상자(클럽명·소진율) 및 벡터 막대 도형(트랙+채움)으로 전환', '보고서 전반 "고유 실인원" / "고유 N명" 표기를 "실인원 N명"으로 통일(2p KPI 카드 및 하단 성과 요약, 5p+ 활동 상세 테이블 합계 행 등)', '클럽별 상세 활동 테이블(5p+) 헤더에서 중복되는 "행사명 (비고)" 열을 생략하고 6개 열(진행일자/결제액/지원금/자부담/상품비/참석인원)로 넓고 쾌적하게 재배치', '슬라이드 전반 글자 크기·행 높이·여백·패딩 전면 재조정: KPI 카드 수직 간격 확대, 도넛 차트 범례 항목 균등 배치, 테이블 셀 상하 마진(3.5pt) 및 하단 참석자 명단 줄간격(1.35배) 확보로 답답함 완전 해소'] },
        { ver: '1.6.307', date: '2026.10.20', items: ['사용자 요청사항 제출 시 관리자 사이트 실시간 팝업과 함께 등록된 Gochujangs33@gmail.com 계정을 통해 개발자(jkim47@mmm.com) 이메일 동시 발송 연동', '연간 결산 PPT 보고서(2p, 3p) 차트 및 글자를 이미지 방식에서 실제 클릭·편집 가능한 네이티브 파워포인트 차트(도넛/가로막대) 및 텍스트 박스로 전면 개편', '결산 보고서 클럽별 실적 비교표(4p) 컬럼 폭 및 셀 패딩 미세 조정으로 "평균인원" 헤더 및 합계 행 금액(15,700,000원 등) 글자 줄바꿈 현상 완전 해결'] },
        { ver: '1.6.304', date: '2026.10.19', items: ['최상단 헤더(로그인/로그아웃 바)에 상시 Dark/Light 화면 테마 토글 버튼 추가 (일반 회원·오프라인 상태에서도 언제든 1클릭으로 테마 전환 지원)', '헤더 테마 토글과 관리자 탭 테마 설정 간의 실시간 양방향 활성화 상태 자동 동기화'] },
        { ver: '1.6.303', date: '2026.10.19', items: ['정산 이력 테이블에서 작성자와 상관없이 모든 회원이 해당 건의 엑셀 파일을 다시 다운로드할 수 있도록 권한 정책 개선', '정산 이력 테이블 행사 날짜 셀에 정산 담당자(👤 정산인: OOO) 정보 표기 및 다운로드 엑셀 파일명에 작성자 이름 자동 포함'] },
        { ver: '1.6.302', date: '2026.10.19', items: ['자동 정산 결과 화면 하단 메인 액션 버튼 문구를 "정산 완료"로 직관적 간소화 ("💾 파일 저장 및 정산 완료" → "💾 정산 완료")'] },
        { ver: '1.6.301', date: '2026.10.19', items: ['라이트 테마에서 "자동 정산 결과" 카드 배경색을 다른 카드(순백/연회색)와 완벽히 동일하게 일치화 (보라/푸른빛 틴트 제거)', '데스크톱 환경에서 우측 패널의 sticky/max-height 제한을 해제하여 자동 정산 결과 카드 하단부(자부담 비율, 총 소요 비용, 잔여 예산, 정산 완료 버튼)가 잘리지 않고 온전히 노출되도록 전체 스크롤 레이아웃 최적화'] },
        { ver: '1.6.300', date: '2026.10.19', items: ['정산 설정(⚙️) 패널 색상 및 비주얼 테마 일체화: 다크/라이트 테마 전용 스타일(순백색 배경·명확한 보더·섀도우 및 텍스트 가독성 최적화) 적용으로 주위 카드와 완벽한 조화 달성', '정산 설정 패널에서 불필요한 "보내는 사람 주소(공통)" 입력칸 및 안내 텍스트 완전 제거 (수신 회사 이메일 및 디바이스 엑셀 저장 옵션으로 화면 간소화)'] },
        { ver: '1.6.294', date: '2026.10.14', items: ['관리자 클럽 및 예산 관리 목록 라이트 테마 색상 보정(어둡게 뜨던 예산·기존사용·상품비·잔여예산 타일 배경 및 인풋·버튼 스타일 라이트 테마 일체화)'] },
        { ver: '1.6.293', date: '2026.10.14', items: ['비용 항목 추가 폼 내 법인카드 결제 금액 입력 칸 너비 최적화 및 우측에 영수증 첨부 버튼 나란히 배치(줄바꿈 방지 및 데스크톱/모바일 칼정렬)'] },
        { ver: '1.6.292', date: '2026.10.14', items: ['라이트 테마 색상 매칭 보정(클럽별 정산 이력 카드·요약 타일·테이블 헤더 및 읽기전용 인풋 스타일 일체화)', '상단 클럽 선택창 배경 화살표(down-arrow) 중복 렌더링 제거로 깔끔한 타이틀 스타일 복원', '비용 항목 추가 폼 내 입력 필드(금액/카테고리/법인카드/개인카드) 수직 여백(gap/margin) 정돈으로 칸 달라붙음 해결'] },
        { ver: '1.6.291', date: '2026.10.14', items: ['로그아웃 및 정산 완료 시 삭제 안내(휴지통 🗑️ 아이콘/삭제 확인) 팝업이 뜨던 안내 문구 버그 수정', '확인 모달(showConfirmModal)에 작업 유형별 커스텀 제목·아이콘(🚪 로그아웃, 💾 정산 완료 등) 및 전용 확인 버튼 지원 추가'] },
        { ver: '1.6.290', date: '2026.10.14', items: ['[대시보드] Bento 지표 카드 상단 컬러 액센트 바 및 실시간 예산 소진율 미니 게이지 바 연동', '[정산화면] 데스크톱 2-Column 분할 유지 및 우측 실시간 정산·예산 요약 패널 Sticky 고정(스크롤 무관 항상 노출)', '모바일/PC 반응형 레이아웃 및 다크/라이트 테마 가독성 유지'] },
        { ver: '1.6.289', date: '2026.10.14', items: ['연간 결산 PPT 보고서 비주얼 디자인 스타일링 및 슬라이드 레이아웃 전면 고도화', '고해상도 캔버스 차트 2종(재원별·용도별 2대 도넛 차트 및 클럽별 예산 소진율 수평 막대 차트) 자동 렌더링 및 슬라이드 삽입', '[신규] 클럽별 핵심 성과 벤치마크 슬라이드(최다 참여·최다 활동·모범 예산 클럽 랭킹 및 경영 인사이트) 및 엔딩 슬라이드(Closing) 추가', '결산 모달 UI 소진율 프로그레스 게이지 바 및 생성 단계별(데이터 취합→차트 렌더링→슬라이드 빌드) 실시간 피드백 지원'] },
        { ver: '1.6.288', date: '2026.10.14', items: ['연간 클럽 결산 및 마감 PPT 보고서 자동 생성 기능 추가 (관리자 전용)', '한 해 동안의 전사 클럽 활동 및 비용 정산(총 배정 예산, 실집행액, 지원금 vs 자부담, 용도별 지출, 임직원 고유 참여율, 상품비 50만원 한도 현황 및 클럽별 상세 타임라인)을 정리한 경영진 보고용 파워포인트(.pptx) 파일 다운로드 지원', '결산 연도 선택 및 지표 요약 미리보기 모달 제공'] },
        { ver: '1.6.287', date: '2026.10.14', items: ['모바일 전체 폰트 크기 및 카드 패딩 슬림화(과도한 줄바꿈 전면 완화)', '월별 차트 막대 위 금액 초컴팩트(N만) 표기 및 9.5px 폰트로 텍스트 겹침 완벽 해결', '모바일 차트 내부 5줄 범례 숨김으로 막대 그래프 가시 영역 2배 확장'] },
        { ver: '1.6.286', date: '2026.10.14', items: ['모바일 관리자 모드 클럽 목록이 압축·찌그러져 보이는 레이아웃 버그 수정(flex-shrink: 0 및 overflow 보정)', '차트 상단 여백 및 Y축 여유 공간(grace 15%, suggestedMax 1.3배) 확대로 막대 위 금액/건수/라벨 잘림 원천 차단', '가로 막대 100% 소진율 등 막대 내부 라벨 가독성 고대비(#ffffff + 텍스트 그림자) 개선'] },
        { ver: '1.6.285', date: '2026.09.22', items: ['로그아웃 클릭 시 브라우저 confirm 대신 앱 커스텀 확인 모달(showConfirmModal)로 전환 및 로그아웃 즉시 로그인 화면으로 전환'] },
        { ver: '1.6.284', date: '2026.09.22', items: ['올해 사용 가능한 총 클럽예산(clubTotalBudget)을 실시간 리스너(.on)로 전환해 초기 인증 완료 및 변경 시 즉시 동기화 보장'] },
        { ver: '1.6.283', date: '2026.09.22', items: ['Firebase API Key 오탈자 수정(39자리 정상화) — 익명 자동 인증 및 비공개 DB 정상 연동'] },
        { ver: '1.6.282', date: '2026.09.22', items: ['Firebase 익명 자동 인증(signInAnonymously) 도입 — 비공개 보안 규칙(auth != null) 환경에서 추가 입력 없이 안전하게 자동 접속', '최신 Firebase Config 동기화(measurementId 반영)'] },
        { ver: '1.6.281', date: '2026.08.27', items: ['카테고리별 비용 비중 도넛을 12시 방향에서 시작해 시계방향으로 연속 노출하는 애니메이션 적용', '도넛 조각별 동시 확대 대신 전체 원을 하나의 부드러운 각도 마스크로 표시', '모바일 재생시간 단축·동작 최소화 설정과 기존 비율·색상·범례·필터 유지'] },
        { ver: '1.6.280', date: '2026.08.27', items: ['관리자 시작 안내의 중복된 4번 로그 기록 확인 항목 제거', '클럽·예산 설정, 정산 기준 확인, 정산 현황 확인 3개 안내를 한 줄로 정돈', '대시보드 상단의 실제 로그 기록 버튼과 전체 작업 로그 기능은 그대로 유지'] },
        { ver: '1.6.279', date: '2026.08.27', items: ['클럽 추가 배정을 일반 예산 수정과 구분해 전체 작업 로그에 별도 기록', '로그 요약과 상세에 기존 배정액·추가 배정액·변경 후 총 배정액·추가 배정 후 잔여금을 함께 표시', '작업 일시·관리자와 기존 사용액·확정 지원금 누적을 보존해 잔여금 산정 근거 확인 가능'] },
        { ver: '1.6.278', date: '2026.08.27', items: ['자부담·회사지원금 추이 곡선을 점별 재생이 아닌 왼쪽부터 오른쪽까지 이어지는 연속 노출 방식으로 개선', 'Light 테마의 페이지·카드·입력창 순백색을 저채도 블루그레이로 낮춰 눈부심 완화', 'PC·모바일에서 차트 좌표·필터·툴팁과 기존 Dark 테마 동작 유지'] },
        { ver: '1.6.277', date: '2026.08.27', items: ['차트 탭 진입 시 세로·가로 막대가 0에서 목표값까지 순차적으로 증가하는 애니메이션 추가', '자부담·회사지원금 추이 곡선을 왼쪽부터 오른쪽으로 그리는 효과와 도넛 차트 회전 효과 적용', '필터·테마·데이터 갱신 때는 모션을 반복하지 않고 모바일 재생시간 단축 및 동작 최소화 설정 지원'] },
        { ver: '1.6.276', date: '2026.08.25', items: ['로그인·접속 이력은 감사 로그 저장 단계에서 제외하고 실제 자료 입력·추가·수정·업데이트·삭제 작업만 표시', '전체 작업 로그를 PC 전체 화면으로 확대하고 연월일·시분초·작업자·권한·PIN·작업 대상을 한눈에 확인하도록 개편', '모바일은 핵심 정보만 간략 표시하고 항목 클릭 시 변경 전후 값과 상세 작업 내용을 펼쳐보도록 최적화'] },
        { ver: '1.6.275', date: '2026.08.25', items: ['역할이 겹치던 행사별 참석 인원 차트를 제거하고 최근 정산 알림으로 통합', '최근 정산 5건에 참석 인원·정산인·지원금을 함께 표시하고 항목 클릭 시 참석자 명단 확인·복사 제공', '클럽별 고유 참석 인원 차트를 전체 폭으로 재배치하고 모바일에서는 최근 5건을 중첩 스크롤 없이 표시'] },
        { ver: '1.6.274', date: '2026.08.25', items: ['Windows 데스크톱에서 글자가 번져 보이던 카드 GPU 블러와 목록 강제 합성 레이어 제거', '한글 전용 대체 글꼴을 명시하고 Light/Dark 보조 글자 명암·굵기·최소 크기를 높여 전체 페이지 가독성 개선', '차트 축·값 라벨을 12px 이상으로 확대하고 고해상도 캔버스 및 모바일 가로 넘침 없음 재검증'] },
        { ver: '1.6.273', date: '2026.08.25', items: ['클럽 자동 색상을 조화로운 선별 팔레트로 정돈하고 모든 클럽 막대 차트에 방향별 3단 그라데이션 적용', '관리자 Dark/Light 선택을 로그인·정산·명부·이력·모달을 포함한 전체 페이지 테마로 확장', '전체 테마의 기기별 저장·초기 로딩 복원과 모바일 가로 넘침 없는 반응형 표시 검증'] },
        { ver: '1.6.272', date: '2026.08.25', items: ['관리자 차트를 KPI·월별 지출·예산 소진율·카테고리·참석·최근 정산 알림을 한 화면에 배치한 프리미엄 대시보드 디자인으로 개편', '클럽 ID 기반 고유 색상과 관리자 색상 선택기를 추가해 모든 클럽 차트·필터에서 동일 색상을 유지', '관리자 대시보드 Dark/Light 테마 전환 및 기기별 설정 기억, 모바일 1열 차트·2열 KPI·스와이프 필터 최적화'] },
        { ver: '1.6.271', date: '2026.08.21', items: ['헤더 최상단에 중복 표시되던 로그 버튼을 제거하고 관리자 대시보드 내 전용 버튼으로 단일화'] },
        { ver: '1.6.270', date: '2026.08.21', items: ['상단 메인 탭바에서 로그 기록 메뉴를 제거해 4개 주요 탭(명부·클럽이력·차트·대시보드)으로 정돈', '로그 기록 조회를 대시보드 상단·시작 가이드 및 헤더의 컴팩트 버튼으로 재배치하고 모달 팝업으로 즉시 확인/닫기 가능하도록 개선'] },
        { ver: '1.6.269', date: '2026.08.20', items: ['사용자·개발자·관리자의 주요 추가·수정·삭제 작업과 시스템 자동 복구를 Firebase 감사 로그에 기록', '관리자 전용 로그 기록 탭에서 날짜·작업자·권한·대상·변경값 조회 및 연월·작업·검색 필터 제공'] },
        { ver: '1.6.268', date: '2026.07.27', items: ['현재 클럽별 사용 요약으로 대체되어 실행되지 않던 구형 관리자 정산 이력 렌더링 코드 제거', '계산·데이터 출처 명세를 현재 실제 자부담 및 예산 산정 방식에 맞게 정비'] },
        { ver: '1.6.267', date: '2026.07.22', items: ['관리자 전체 사용 요약에서 선택한 이력 원본을 수정 모드 동안 보관해 날짜·금액 수정 저장 오류 해결'] },
        { ver: '1.6.266', date: '2026.07.22', items: ['관리자 클럽별 정산 사용 요약의 각 행사 행에 삭제 버튼 복원', '정산 날짜 선택 시 같은 클럽의 동일 날짜 이력을 즉시 안내(수정 중인 이력 자신은 제외)'] },
        { ver: '1.6.265', date: '2026.07.22', items: ['일반 사용자도 선택한 클럽의 공유 정산 이력을 작성자와 관계없이 수정하고, 원 작성자 이력·참석 누적을 함께 동기화', '상품비 이력 수정 시 기존 금액을 누적 기준에서 먼저 제외해 변경 차액만 반영'] },
        { ver: '1.6.264', date: '2026.07.21', items: ['전 화면 공통 모바일 레이아웃 점검 및 보강: 클럽 관리·입력 폼·모달·긴 표의 가로 넘침 제거', '모바일 차트의 많은 항목과 버튼·입력 영역을 터치하기 쉬운 크기와 세로 흐름으로 조정'] },
        { ver: '1.6.263', date: '2026.07.21', items: ['모바일 클럽별 정산 이력을 행사별 세로 정보 카드로 전환해 가로 잘림 없이 확인', '모바일에서도 행사 날짜 수정·참석자 명단·엑셀 다시 받기 버튼을 한 행에서 사용 가능'] },
        { ver: '1.6.262', date: '2026.07.21', items: ['일반 사용자 정산 이력도 클럽별 사용 요약·총 상품비·날짜 수정·참석자 명단 확인 방식으로 통일', '사용자 본인 정산 행에 엑셀 다시 받기 버튼 추가'] },
        { ver: '1.6.261', date: '2026.07.21', items: ['관리자 클럽별 사용 요약의 정산 이력 상세·수정 영역을 제거하고 행사 날짜 클릭으로 바로 수정 진입', '상단 사용 안내와 총 상품비 요약을 추가'] },
        { ver: '1.6.260', date: '2026.07.21', items: ['관리자 클럽별 정산 이력에서 모든 클럽의 사용 요약과 행사별 비용 표를 즉시 표시', '행사별 참석 인원 숫자를 클릭하면 이름·사번 명단 확인과 복사가 가능하도록 연결'] },
        { ver: '1.6.259', date: '2026.07.21', items: ['관리자 클럽별 정산 이력에서 클럽 선택 상자를 없애고 모든 등록 클럽을 기본 접힘 목록으로 표시', '새로 등록된 정산은 해당 클럽에 신규 등록 건수로 표시하고, 클럽을 펼쳐 확인하면 읽음 처리'] },
        { ver: '1.6.258', date: '2026.07.21', items: ['일반 사용자 정산 이력의 참석자 명단을 기본 접힘으로 분리하고, 펼치면 이름과 사번을 확인하도록 개선'] },
        { ver: '1.6.257', date: '2026.07.21', items: ['일반 사용자 정산 이력에도 클럽별 그룹·접기/펼치기·올해 사용 요약 버튼을 관리자 화면과 동일하게 적용'] },
        { ver: '1.6.256', date: '2026.07.21', items: ['관리자 클럽별 정산 이력의 전체 보기를 월별 혼합 목록에서 클럽별 그룹으로 변경하고, 각 클럽 그룹에서 사용 요약을 바로 열 수 있도록 개선'] },
        { ver: '1.6.255', date: '2026.07.21', items: ['일반 사용자 정산 이력의 상세 내역에도 행사비·시설 및 장비 이용료·상품비 카테고리를 관리자 화면과 동일하게 표시'] },
        { ver: '1.6.254', date: '2026.07.21', items: ['월별 지출 현황 차트의 세로축과 막대 합계 금액을 K·M 대신 한국 원화 단위(억·만·천·원)로 표시'] },
        { ver: '1.6.253', date: '2026.07.21', items: ['클럽 사용 요약 팝업에 관리자 클럽 레지스트리 기준의 클럽 총 예산과 현재 잔여 예산을 추가'] },
        { ver: '1.6.252', date: '2026.07.21', items: ['자부담·회사지원금 추이 카드에 총 회사 지원금과 총 자부담 비용 누적 요약을 추가', '클럽별 정산 횟수 차트의 막대를 클릭하면 올해 행사별 날짜·참석 인원·비용 카테고리·회사 지원금·자부담·총 비용을 표로 확인하도록 개선'] },
        { ver: '1.6.251', date: '2026.07.20', items: ['두 참석 인원 차트에서 마우스 오버 시 이름·사번 명단을 다시 표시하고, 막대 클릭 시 명단 팝업과 복사 기능도 함께 유지하도록 개선'] },
        { ver: '1.6.250', date: '2026.07.20', items: ['이전 앱 셸 캐시가 최신 차트 기능을 받지 못하던 문제를 해결하기 위해 HTML·JS·CSS는 서비스워커에서 HTTP 캐시를 우회해 항상 최신 파일을 확인하도록 개선'] },
        { ver: '1.6.249', date: '2026.07.20', items: ['참석자 이름·사번이 길어 차트 툴팁에서 잘리던 문제를 수정해, 두 참석 인원 차트의 막대를 클릭하면 스크롤 가능한 명단 팝업을 열고 명단 복사도 가능하도록 개선'] },
        { ver: '1.6.248', date: '2026.07.20', items: ['행사별 참석 인원과 클럽별 참석 인원(중복 제외) 차트의 막대에 마우스를 올리면 해당 참석자의 이름과 사번 목록을 함께 표시'] },
        { ver: '1.6.247', date: '2026.07.20', items: ['관리자 시작 안내에서 전사원 명부 관리를 제외하고, 클럽·예산 설정과 정산 기준 확인을 다시 누르면 해당 설정 카드를 접는 토글 방식으로 개선'] },
        { ver: '1.6.246', date: '2026.07.20', items: ['관리자 첫 화면에 시작 안내와 바로가기 4단계를 추가해 클럽·예산 설정, 정산 기준 확인, 명부 관리, 차트 확인의 순서를 한눈에 안내'] },
        { ver: '1.6.245', date: '2026.07.20', items: ['행사별 참석 인원 그래프를 최근 10건으로 조정하고, 모든 막대의 왼쪽 클럽명·날짜 레이블이 생략되지 않도록 고정 표시'] },
        { ver: '1.6.244', date: '2026.07.20', items: ['현재 참석자 중복 사번 안내를 브라우저 기본 팝업 대신 이름 입력란 옆의 빨간 문구로 변경하고, 입력을 수정하면 안내가 즉시 사라지도록 개선'] },
        { ver: '1.6.243', date: '2026.07.20', items: ['현재 참석자 추가·수정에서 이름과 무관하게 동일 사번을 중복 등록하지 못하도록 차단하고, 이미 등록된 참석자 이름·사번을 팝업으로 안내'] },
        { ver: '1.6.242', date: '2026.07.20', items: ['영수증·행사 사진을 긴 변 기준 저용량 JPEG로 변환해 서버에 저장하고, 확정 이력의 첨부 원본은 전체 정산 이력에만 보관해 개인 이력 중복 용량을 제거', '첨부 총량 6MB 제한과 서버 저장 성공·실패 안내를 추가하고, 정산 다음 해 4월 1일 이후 만료 사진·영수증을 관리자 로그인 시 자동 정리'] },
        { ver: '1.6.241', date: '2026.07.20', items: ['관리자 정산 이력을 저장 시각이 아닌 실제 정산일 기준 최신순으로 정렬하고 같은 날짜는 최근 저장 건을 먼저 표시', '클럽별 연간 예산 소진율과 예산 통계에서 과거 연도 이력을 제외하고 올해 기존 사용액과 올해 정산 지원금만 합산'] },
        { ver: '1.6.240', date: '2026.07.20', items: ['정산 이력의 참석자 수정·삭제 시 이름이 아닌 사번 기준으로 올해 누적 참석 횟수를 전체 재집계하고 관리자·작성자 명부에 함께 반영', '관리자가 다른 사용자의 이력을 수정할 때 작성자 개인 이력도 공유 이력과 함께 동기화', '행사 사진을 신규·수정 정산 이력에 저장하고 과거 이력 엑셀에는 해당 이력의 사진만 삽입하도록 개선'] },
        { ver: '1.6.239', date: '2026.07.20', items: ['정산 확정 시 공유 이력·개인 이력·클럽 누적액·세션 초기화를 Firebase에 원자적으로 저장하고, 저장 성공 후에만 입력 내용을 초기화하도록 개선', '동시 정산·이력 수정 시 클럽 사용액과 상품비 누적액이 서로 덮어써지지 않도록 서버 증분 방식 적용', '이력 수정 저장 실패가 성공으로 처리되던 문제를 수정해 실패 시 수정 화면과 입력 내용을 그대로 유지'] },
        { ver: '1.6.238', date: '2026.07.20', items: ['모바일 가입 회원 관리 표를 회원별 카드형 행으로 재배치해 가입일·최근 접속 날짜가 한 글자씩 줄바꿈되지 않고 수정·삭제 버튼이 안정적으로 보이도록 개선'] },
        { ver: '1.6.237', date: '2026.07.20', items: ['일반 사용자 정산 이력에서 선택한 클럽의 이력이 0건일 때 다른 클럽의 개인 이력 전체가 표시되던 문제 수정', '상품비가 있는 정산 이력의 간단 요약에 상품비 금액 표시', '구버전 정산 이력의 expenseItems에서 상품비를 역산해 누적액을 복구하고, 신규·수정 이력에는 prizeCost를 명시 저장하도록 개선'] },
        { ver: '1.6.236', date: '2026.07.17', items: ['"행사별 참석 인원" 차트를 가로 목록형으로 개편 — 한 줄에 "클럽명 날짜 → 인원수"가 바로 읽히도록 (최근 15건, 최신순)'] },
        { ver: '1.6.235', date: '2026.07.16', items: ['가로 막대 차트에서 막대가 끝까지 차면 값 라벨(예: "28명")이 잘리던 문제 수정 — 공간이 없으면 막대 안쪽에 자동 표시'] },
        { ver: '1.6.234', date: '2026.07.16', items: ['새 차트 2개 추가 — "행사별 참석 인원"(정산 1건마다 참석 인원수, 클럽 고유 색), "클럽별 참석 인원(중복 제외)"(올해 각 클럽에 참석한 서로 다른 인원수, 많은 순)', '관리자 "추가 배정" 팝업에서 금액 입력 후 Enter로 바로 적용 (Escape는 취소)'] },
        { ver: '1.6.233', date: '2026.07.16', items: ['클럽 전환·정산 초기화 후 상품비 연간 누적액이 0으로 지워져 연 50만원 한도 검증이 뚫릴 수 있던 문제 수정', '상품비 누적액 아래에 올해 잔여 한도 표시 추가', '시설·장비 법인카드를 수동 입력해도 인당 85,000원 × 인원수 한도를 초과할 수 없도록 차단', '오프라인 상태에서 회원가입 시도 시 안내 문구 표시 (기존엔 무반응)'] },
        { ver: '1.6.232', date: '2026.07.16', items: ['시설·장비 이용료 계산 방식 최종 정리 — 인원수와 무관하게 항상 인당 85,000원(관리자 설정 가능) × 참석 인원수까지만 법인카드, 초과분은 자동 자부담', '카테고리 선택 시 뜨던 승인 체크박스·2버튼 팝업을 단순 안내 팝업(확인 버튼만)으로 교체'] },
        { ver: '1.6.231', date: '2026.07.16', items: ['신규 가입 시 이름·PIN이 모두 기존 가입자와 동일하면 "이미 가입되어 있습니다." 문구로 안내 (PIN만 겹치고 이름이 다른 진짜 충돌은 기존 문구 유지)'] },
        { ver: '1.6.230', date: '2026.07.16', items: ['정산 이력 수정 중 "수정 취소"를 눌러도 팝업 없이 비용 정산 화면이 바로 정산 초기화되도록 수정'] },
        { ver: '1.6.229', date: '2026.07.16', items: ['정산 이력 수정 완료 후 비용 정산 화면이 자동으로 "정산 초기화"되도록 수정 (이전엔 수정한 내용이 그대로 남아있었음)', '시설·장비 기본(미승인) 법인카드 제안액을 행사비와 같은 "인당 지원 한도 풀"에 합산해서 계산하도록 수정 — 이미 다른 행사비가 있어도 새 시설비마다 100% 법인카드로 잘못 제안되던 문제 수정'] },
        { ver: '1.6.228', date: '2026.07.16', items: ['시설·장비 이용료 선택 즉시 뜨던 승인 팝업 제거 — 기본값은 행사비와 동일한 인당 지원 한도 자동 적용', '"이사진 승인 한도 증액" 체크박스 추가 — 체크 시 확인 팝업 후 인당 최대 85,000원까지 법인카드 한도 증액'] },
        { ver: '1.6.227', date: '2026.07.16', items: ['시설·장비 이용료가 100만원을 초과하면 뜨던 "별도 협의가 필요합니다" 경고 문구 삭제 (근거 불명확 — 사용자 요청)'] },
        { ver: '1.6.226', date: '2026.07.14', items: ['대시보드 차트(월별 지출 현황·예산 소진율·클럽별 정산 횟수) 전체에서 같은 클럽은 항상 같은 색으로 통일', '예산 소진율 차트는 막대색 대신 소진율 % 숫자 글씨색으로 위험도(안전/주의/초과) 표시'] },
        { ver: '1.6.225', date: '2026.07.14', items: ['클럽별 예산 소진율 차트 호버 시 표시 순서를 소진율·예산·사용·잔여 순으로 정리 (잔여 금액 추가)'] },
        { ver: '1.6.224', date: '2026.07.13', items: ['업데이트 내역 목록에 그동안 누락됐던 v1.6.184~223 일괄 추가'] },
        { ver: '1.6.223', date: '2026.07.13', items: ['전사원 명부 정렬 기준을 이름→사번 단위로 변경 — 동명이인 중 미참석자가 참석자 옆에 딸려오던 문제 수정'] },
        { ver: '1.6.222', date: '2026.07.13', items: ['호버 툴팁을 전역 방식으로 교체 — 스크롤 영역에 잘리지 않도록 수정', '클럽 관리 "추가 배정"·"올해 기존 사용"에도 설명 툴팁 추가'] },
        { ver: '1.6.221', date: '2026.07.13', items: ['"85,000원 초과 승인" 버튼 축소 + 호버 설명 추가', '이 승인은 1회성 — 정산 확정 시 자동으로 미승인 상태로 복귀'] },
        { ver: '1.6.220', date: '2026.07.13', items: ['인당 85,000원 초과 지원은 관리자가 클럽별로 사전승인하는 방식으로 변경 (클럽 관리 탭 토글)'] },
        { ver: '1.6.219', date: '2026.07.13', items: ['인당 지원 한도 초과 확인 팝업을 2단계(주의/심각)로 재설계 — 트리거 조건을 정책 계산값 기준으로 수정'] },
        { ver: '1.6.218', date: '2026.07.13', items: ['행사비 인당 지원액이 85,000원 한도를 초과하면 이사진 승인 확인 팝업 추가'] },
        { ver: '1.6.217', date: '2026.07.13', items: ['클럽 예산 소진 후에도 법인카드 0원(전액 자부담)으로 두면 비용 항목 추가가 항상 가능하도록 수정'] },
        { ver: '1.6.216', date: '2026.07.13', items: ['예산 소진 후에도 새 항목에 법인카드가 계속 자동 제안되던 버그 수정'] },
        { ver: '1.6.215', date: '2026.07.13', items: ['비용 항목별 법인/개인카드 배분 금액이 실제 자부담·지원금·잔여예산 계산에 직접 반영되도록 변경 (4단계 구간표는 참고값으로 유지)'] },
        { ver: '1.6.214', date: '2026.07.13', items: ['이력 수정 화면에서 실제로는 예산이 남아있는데도 "잔여 예산 초과"로 잘못 막히던 문제 수정'] },
        { ver: '1.6.213', date: '2026.07.13', items: ['정산 이력 금액 수정 시 클럽 예산이 새 금액만큼 추가되던 버그 수정 — 차액만 반영되도록 수정'] },
        { ver: '1.6.212', date: '2026.07.10', items: ['참석자 검색 시 동명이인 중 이 클럽에 최근 참석한 사번을 강조 표시'] },
        { ver: '1.6.211', date: '2026.07.10', items: ['카테고리 비중 차트 범례 글씨가 안 보이던 버그 수정', '월별 지출·소진율 등 차트에 값을 직접 표시'] },
        { ver: '1.6.210', date: '2026.07.10', items: ['카테고리별 비용 비중 차트 범례에 금액·비율 직접 표시'] },
        { ver: '1.6.209', date: '2026.07.10', items: ['클럽 목록에 "올해 기존 사용" 인라인 입력칸 추가 — 입력 즉시 잔여예산 반영'] },
        { ver: '1.6.208', date: '2026.07.10', items: ['클럽 관리에 "올해 기존 사용 금액" 입력칸 추가'] },
        { ver: '1.6.207', date: '2026.07.10', items: ['로그인 화면 버전 표시를 서버 배포 버전 기준으로 변경 — 캐시 문제와 무관하게 항상 정확히 표시'] },
        { ver: '1.6.206', date: '2026.07.10', items: ['전사원 명부 탭 버튼 인원수 표기를 사번 기준으로 통일'] },
        { ver: '1.6.205', date: '2026.07.10', items: ['명부 JSON·서비스워커 자산의 브라우저 캐시를 완전히 우회하도록 수정'] },
        { ver: '1.6.204', date: '2026.07.10', items: ['전사원 명부 JSON 갱신이 로그인 시 즉시 반영되지 않던 캐시 문제 수정'] },
        { ver: '1.6.203', date: '2026.07.10', items: ['로그인 화면 버전 표시가 구버전(1.6.187)에 고정되던 버그 수정'] },
        { ver: '1.6.202', date: '2026.07.10', items: ['전사원 명부 동명이인 40쌍 전수 등록', '앱 업데이트 자동 반영(서비스워커 캐시 회전) 수정'] },
        { ver: '1.6.201', date: '2026.07.05', items: ['코드리뷰 후속 수정 — 이력 로드 전 0원이 clubRegistry를 덮어쓰던 문제 등 4건 수정'] },
        { ver: '1.6.200', date: '2026.07.02', items: ['클럽 중복 생성 방지(리스너 누적 버그 수정)', '클럽 관리 목록에 번호 매기기 추가'] },
        { ver: '1.6.199', date: '2026.07.02', items: ['클럽 관리 화면 잔여예산이 가끔 0원으로 표시되던 경쟁조건 버그 수정'] },
        { ver: '1.6.198', date: '2026.07.02', items: ['전사원 명부 카운트, 사번 없는 이력은 집계에서 완전히 제외 (동명이인 오귀속 방지)'] },
        { ver: '1.6.197', date: '2026.07.02', items: ['전사원 명부 "올해 누적" 카운트가 0회로 표시되던 버그 수정'] },
        { ver: '1.6.196', date: '2026.07.02', items: ['사번 없는 구버전 이력 호환 처리 복원 — 이름 단일 매핑'] },
        { ver: '1.6.195', date: '2026.07.02', items: ['사번(EMP ID) 입력 필수화 — 미입력 시 에러 메시지, 카운트 로직 단순화'] },
        { ver: '1.6.194', date: '2026.07.02', items: ['정산 이력의 참석자 목록에 사번 표시 추가'] },
        { ver: '1.6.193', date: '2026.07.02', items: ['명부 카운트, 이름 기준 폴백 완전 제거 — 사번 기준으로만 집계'] },
        { ver: '1.6.192', date: '2026.07.02', items: ['사번별 카운트 초기화 로직 수정 — "undefined" 표시 버그 수정'] },
        { ver: '1.6.191', date: '2026.07.02', items: ['사번별 독립 누적 카운트 구현 — 동명이인 카운트 분리'] },
        { ver: '1.6.190', date: '2026.07.02', items: ['차트 KPI 카드 제거, 차트 렌더링 타이밍 버그 수정'] },
        { ver: '1.6.189', date: '2026.07.02', items: ['차트 탭 전체 리디자인 — 2컬럼 그리드, 통합 클럽 필터, 활동량 차트 추가'] },
        { ver: '1.6.188', date: '2026.07.02', items: ['로그아웃 시 수정 모드 상태 초기화'] },
        { ver: '1.6.187', date: '2026.07.02', items: ['상품비 10명 미만 경고 문구 중복 제거 (UI 검증에서만 처리)'] },
        { ver: '1.6.186', date: '2026.07.02', items: ['관리자가 정산 이력의 정산인 이름을 직접 수정하는 기능 추가'] },
        { ver: '1.6.185', date: '2026.07.02', items: ['자부담/지원금 추이 차트의 포인트 위치가 잘못 표시되던 버그 수정'] },
        { ver: '1.6.183', date: '2026.07.02', items: ['유저 접속 시 globalHistory 기준 잔여 예산 자동 반영 — 관리자 개입 없이 모든 사용자 정산이 잔여 예산에 즉시 표시', '클럽 선택 변경 시에도 자동 재계산'] },
        { ver: '1.6.182', date: '2026.07.02', items: ['관리자 로그인 시 globalHistory 전체 기준으로 명부 누적 카운트 자동 재계산 — 모든 사용자 정산 이력 반영'] },
        { ver: '1.6.181', date: '2026.07.02', items: ['명부 누적 카운트 사번 기준으로 변경 — 동명이인(같은 이름, 다른 사번) 정확히 구분'] },
        { ver: '1.6.180', date: '2026.07.02', items: ['정산 이력 클럽 단위 전체 공유 — 같은 클럽이면 다른 사용자 정산 이력도 표시', '이력 카드에 정산인 이름 표시 (👤), 타인 항목 수정 버튼 숨김'] },
        { ver: '1.6.176', date: '2026.07.01', items: ['이력 카드 날짜 표시 개선 — settlementDate 우선 표시, 수정 시각은 날짜+시간 함께 표시'] },
        { ver: '1.6.171', date: '2026.07.01', items: ['엑셀 파일명 형식 변경 — 클럽명(날짜).xlsx'] },
        { ver: '1.6.170', date: '2026.07.01', items: ['"파일 저장 및 정산 완료" 버튼명 변경 + 클릭 시 확인 팝업 추가'] },
        { ver: '1.6.169', date: '2026.07.01', items: ['클럽 깜빡임 버그 수정 — Firebase 일괄 삭제로 변경', '엑셀 저장 후 데이터 초기화 누락 수정'] },
        { ver: '1.6.168', date: '2026.07.01', items: ['중복 클럽 3중 방지 — Firebase 자동 정리, 화면 필터, 대소문자 무시 선택'] },
        { ver: '1.6.167', date: '2026.07.01', items: ['중복 클럽 일괄 정리 버튼 추가 (클럽 관리 탭)'] },
        { ver: '1.6.166', date: '2026.07.01', items: ['클럽 이름 중복 추가 방지 — 동일 이름 등록 시 경고 팝업'] },
        { ver: '1.6.165', date: '2026.07.01', items: ['모바일 줄바꿈 개선: 탭 버튼 자연스러운 줄바꿈, 카드 헤더 오버플로 수정, 정산 날짜 힌트 줄 분리, 달력 네비게이션 정렬'] },
        { ver: '1.6.164', date: '2026.07.01', items: ['업데이트 내역 날짜별 그룹핑 표시, 버전 표시 app.js 내장값 기준으로 신뢰성 개선'] },
        { ver: '1.6.163', date: '2026.07.01', items: ['행사 사진 여러 장 첨부 지원 (엑셀 sheet3에 우측으로 순서대로 배치, 개별 삭제 가능)'] },
        { ver: '1.6.162', date: '2026.07.01', items: ['정산 날짜 달력 피커 추가 — 탭하면 달력 팝업으로 월/일 선택'] },
        { ver: '1.6.161', date: '2026.07.01', items: ['정산 날짜 입력란을 정산 결과 카드 상단으로 이동 (저번달 등 소급 등록 편의 개선)'] },
        { ver: '1.6.160', date: '2026.06.29', items: ['한영 전환 토글 삭제 — 한국어 전용으로 단순화'] },
        { ver: '1.6.159', date: '2026.06.29', items: ['영수증 미첨부 항목에 "영수증을 첨부하세요" 안내 문구 표시'] },
        { ver: '1.6.158', date: '2026.06.29', items: ['모든 삭제 버튼에 확인 팝업 추가 (비용·참석자·명부·클럽)'] },
        { ver: '1.6.157', date: '2026.06.29', items: ['코드 리뷰 버그 6건 수정 (잔여예산 연도 필터, 수정모드 가드, Firebase 경쟁 조건, 중복 탭 핸들러, 캐시 플래그 이중소비, 모달 리스너 누적)'] },
        { ver: '1.6.155', date: '2026.06.28', items: ['로그인 화면 버전·업데이트 날짜 표시 (PIN 안내 문구 제거)'] },
        { ver: '1.6.154', date: '2026.06.28', items: ['캐시 초기화 버튼 1회 클릭으로 업데이트 자동 완료'] },
        { ver: '1.6.153', date: '2026.06.28', items: ['클럽 배정 예산 + 전체 총 예산 이중 차단 강화', 'usedBudget Firebase 동기화로 다중 사용자 예산 정확화'] },
        { ver: '1.6.152', date: '2026.06.28', items: ['상품비 누적액 Firebase 자동 교정 (관리자 화면 열 때 불일치 수정)'] },
        { ver: '1.6.151', date: '2026.06.28', items: ['차트 탭 전환 시 재렌더 (빈 차트 버그 수정)', '차트 집계를 settlementDate 기준으로 통일'] },
        { ver: '1.6.150', date: '2026.06.28', items: ['관리자 로그인 시 첫 화면이 대시보드 탭으로 자동 전환'] },
        { ver: '1.6.149', date: '2026.06.27', items: ['상품비 누적액을 정산이력 기준으로 동적 재계산', '회원 수정 팝업을 커스텀 모달로 교체 (이름/PIN 수정 가능)'] },
        { ver: '1.6.148', date: '2026.06.27', items: ['가입 회원 관리 삭제 확인 팝업 추가', '회원 목록에 최근 접속일시 컬럼 추가'] },
        { ver: '1.6.147', date: '2026.06.26', items: ['클럽별 정산이력 삭제 확인 팝업 추가', '헤더에 최근 접속일시 표시', '정산 날짜 직접 입력 가능 (소급 등록 지원)'] },
        { ver: '1.6.146', date: '2026.06.26', items: ['클럽 예산 소진 시 비용 추가 완전 차단', '잔여 예산 초과 입력 시 팝업 경고'] },
        { ver: '1.6.143', date: '2026.06.20', items: ['시설·장비 이사진 승인 법인카드 한도 관리자 설정 추가'] },
        { ver: '1.6.142', date: '2026.06.20', items: ['시설·장비 사전 승인 팝업 추가', '승인 완료 시 법인카드 85,000원 한도 적용'] },
        { ver: '1.6.137', date: '2026.06.15', items: ['삭제한 이력 재출현 완전 차단 (Tombstone)', '캐시 초기화 버튼 추가'] },
        { ver: '1.6.135', date: '2026.06.14', items: ['클럽별 비용 지출 비교 차트 추가'] },
        { ver: '1.6.134', date: '2026.06.14', items: ['상품비 클럽별 누적 관리 + 연간 한도 관리자 설정'] },
        { ver: '1.6.125', date: '2026.06.10', items: ['상품비 누적액 자동 계산 + 인원/한도 검증 팝업'] },
        { ver: '1.6.120', date: '2026.06.08', items: ['비용 입력 시 법인/개인카드 금액 자동 계산'] },
        { ver: '1.6.110', date: '2026.06.05', items: ['동명이인 사번 선택 팝업 추가', '전사원 명부 동명이인 별도 행 표시'] },
        { ver: '1.6.90', date: '2026.05.28', items: ['관리자 설정 실시간 동기화', '정산 이력 수정 기능 추가'] },
        { ver: '1.6.75', date: '2026.05.22', items: ['클럽별 정산이력 정산인 선택 드롭다운 (2명 이상일 때만 표시)'] },
        { ver: '1.6.54', date: '2026.05.15', items: ['차트 탭 추가: 월별 추이, 예산 소진율, 카테고리 비중, 자부담 추이'] },
    ];

    (function initChangelog() {
        const overlay = document.getElementById('changelog-modal-overlay');
        const content = document.getElementById('changelog-content');
        const closeBtn = document.getElementById('changelog-close-btn');
        const verEl    = document.getElementById('app-version-info');
        if (!overlay || !content || !verEl) return;

        // 버전 표시를 app.js에 내장된 값으로 즉시 업데이트 (localStorage/SW 메시지 의존 제거)
        verEl.textContent = `v${APP_VERSION}  ·  ${APP_VERSION_DATE} 업데이트`;

        function openChangelog() {
            // 날짜별로 그룹핑 (같은 날 여러 버전 → 한 블록으로)
            const groups = [];
            const seen = {};
            for (const entry of CHANGELOG) {
                if (!seen[entry.date]) {
                    seen[entry.date] = { date: entry.date, versions: [], items: [] };
                    groups.push(seen[entry.date]);
                }
                seen[entry.date].versions.push(entry.ver);
                seen[entry.date].items.push(...entry.items);
            }

            content.innerHTML = groups.map(g => {
                const vRange = g.versions.length === 1
                    ? `v${g.versions[0]}`
                    : `v${g.versions[g.versions.length - 1]} ~ v${g.versions[0]}`;
                return `
                <div style="margin-bottom:1rem; padding-bottom:1rem; border-bottom:1px solid rgba(139,92,246,0.15);">
                    <div style="display:flex; align-items:baseline; gap:0.5rem; margin-bottom:0.35rem; flex-wrap:wrap;">
                        <span class="changelog-date" style="font-size:0.8rem; font-weight:700;">${g.date}</span>
                        <span class="changelog-vrange" style="font-size:0.75rem;">${vRange}</span>
                    </div>
                    <ul style="margin:0; padding-left:1.1rem; display:flex; flex-direction:column; gap:0.2rem;">
                        ${g.items.map(i => `<li class="changelog-item" style="font-size:0.78rem; line-height:1.45;">${i}</li>`).join('')}
                    </ul>
                </div>`;
            }).join('');
            overlay.style.display = 'flex';
        }

        verEl.addEventListener('click', openChangelog);
        closeBtn.addEventListener('click', () => { overlay.style.display = 'none'; });
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.style.display = 'none'; });
    })();

    // 앱 캐시 초기화 — 구버전 캐시 강제 삭제 후 최신 버전 재로드 (1회 클릭으로 완료)
    const clearCacheBtn = document.getElementById('clear-cache-btn');
    if (clearCacheBtn) {
        clearCacheBtn.addEventListener('click', async () => {
            clearCacheBtn.textContent = '초기화 중...';
            clearCacheBtn.disabled = true;
            // 리로드 후 SW_UPDATED 배너를 자동 억제하기 위한 플래그
            sessionStorage.setItem('cache_just_cleared', '1');
            try {
                if ('serviceWorker' in navigator) {
                    const regs = await navigator.serviceWorker.getRegistrations();
                    // 대기 중인 워커가 있으면 skipWaiting 먼저 호출
                    regs.forEach(r => { if (r.waiting) r.waiting.postMessage({ action: 'skipWaiting' }); });
                    await Promise.all(regs.map(r => r.unregister()));
                }
                if ('caches' in window) {
                    const keys = await caches.keys();
                    await Promise.all(keys.map(k => caches.delete(k)));
                }
            } catch (e) { /* ignore */ }
            // cache-busting 쿼리로 브라우저 HTTP 캐시까지 우회하여 최신 버전 강제 로드
            const url = new URL(window.location.href);
            url.searchParams.set('_cb', Date.now());
            window.location.replace(url.href);
        });
    }

    // Toggle to Login mode
    document.getElementById('go-to-login').addEventListener('click', () => {
        document.getElementById('login-mode-section').classList.remove('hidden');
        document.getElementById('register-mode-section').classList.add('hidden');
        resetPinInput();
        pinErrorText.classList.add('hidden');
    });

    // Submit Registration
    document.getElementById('submit-register-btn').addEventListener('click', () => {
        const name = document.getElementById('register-name-input').value.trim();
        const rawEmailPrefix = (document.getElementById('register-email-prefix-input')?.value || '').trim();
        const emailPrefix = rawEmailPrefix.replace(/@.*$/, '').trim();
        const email = emailPrefix ? `${emailPrefix}@mmm.com` : '';
        const pin = document.getElementById('register-pin-input').value.trim();
        const regError = document.getElementById('register-error-text');

        if (!name) {
            regError.textContent = "이름을 입력해 주세요.";
            regError.classList.remove('hidden');
            return;
        }
        if (pin.length !== 6 || isNaN(pin)) {
            regError.textContent = "6자리 숫자의 PIN 번호를 입력해 주세요.";
            regError.classList.remove('hidden');
            return;
        }
        if (pin === "000000") {
            regError.textContent = "000000은 관리자용 PIN 번호이므로 등록할 수 없습니다.";
            regError.classList.remove('hidden');
            return;
        }
        if (!emailPrefix || /\s/.test(emailPrefix)) {
            regError.textContent = "회사 이메일 아이디(@mmm.com 앞부분)를 공백 없이 입력해 주세요.";
            regError.classList.remove('hidden');
            return;
        }

        regError.classList.add('hidden');

        // 오프라인(Firebase 미초기화) 상태에서는 안내 후 중단 — 이전엔 TypeError로 버튼이 무반응이었음 (v1.6.233)
        if (!firebaseDb) {
            regError.textContent = "인터넷 연결 후 가입할 수 있습니다. 네트워크 상태를 확인해 주세요.";
            regError.classList.remove('hidden');
            return;
        }

        // Check if PIN already exists in Firebase
        firebaseDb.ref(`users/${pin}`).once('value').then(snapshot => {
            if (snapshot.exists()) {
                // 이름·PIN이 모두 동일 → 본인이 이미 가입한 경우로 간주(다른 번호를 고르라는 안내 대신
                // "이미 가입되어 있습니다" 문구로 안내). 이름은 다른데 PIN만 겹치면 기존 문구 유지.
                const existing = snapshot.val();
                if (existing && existing.name === name) {
                    regError.textContent = "이미 가입되어 있습니다.";
                } else {
                    regError.textContent = "이미 등록된 PIN 번호입니다. 다른 번호를 입력해 주세요.";
                }
                regError.classList.remove('hidden');
            } else {
                // Register User
                const registeredAt = Date.now();
                const initialRole = AppState.normalizeUserRole(null, pin);
                const initialAdmin = AppState.checkHasAdminAccess(null, pin);
                const registrationUpdates = {
                    [`users/${pin}`]: { name, email, registeredAt, role: initialRole, isAdmin: initialAdmin },
                    [`settlements/${pin}/reportEmail`]: email
                };
                AppState.appendAuditUpdate(registrationUpdates, {
                    action: 'CREATE',
                    targetType: '신규 가입',
                    targetId: pin,
                    targetLabel: `${name} (${pin})`,
                    summary: `신규 회원 '${name} (${pin})' 가입 등록`,
                    details: { 이름: name, PIN: pin, 이메일: email, 권한: AppState.getRoleLabel(initialRole, initialAdmin) }
                }, { pin, name, role: AppState.getRoleLabel(initialRole, initialAdmin) });
                firebaseDb.ref().update(registrationUpdates).then(() => {
                    alert(`${name}${t('alert.register_success')}`);
                    
                    // Automatically log in
                    AppState.isLoggedIn = true;
                    AppState.currentPin = pin;
                    AppState.userName = name;
                    AppState.reportEmail = email;
                    AppState.userRole = initialRole;
                    AppState.hasAdminAccess = initialAdmin;
                    AppState._bindUserRoleListener(pin);
                    AppState.save();
                    
                    setAdminMode(false);
                    syncHeaderAdminButton();
                    pinModal.classList.add('hidden');
                    statusBadge.className = 'badge-online';
                    const roleBadgeText = AppState.userRole === 'president' ? ' 👑회장' : (AppState.userRole === 'developer' ? ' 💻개발자' : (AppState.hasAdminAccess ? ' 🛡️관리자' : ''));
                    statusBadge.innerHTML = `${t('status.online')} (${name}${roleBadgeText} / PIN: ${pin})`;
                    logoutBtn.style.display = 'inline-block';
                    loginBtn.style.display = 'none';
                    
                    // Sync values to form fields
                    AppState.loadClubRegistry().then(renderClubOptions);
                    memberInput.value = AppState.memberCount || 0;
                    prizeInput.value = AppState.previousPrizeTotal || 0;
                    setSettingsFormValues(AppState.rules);
            if (typeof setAdminRulesFormValues === 'function') setAdminRulesFormValues(AppState.rules);
                    AppState.render();
                }).catch(err => {
                    regError.textContent = "가입 등록에 실패했습니다. 네트워크를 확인해 주세요.";
                    regError.classList.remove('hidden');
                });
            }
        }).catch(() => {
            // PIN 중복 확인 자체가 실패한 경우(네트워크 오류 등) — 이전엔 아무 안내 없이 무반응이었음 (v1.6.233)
            regError.textContent = "네트워크 오류로 가입 확인에 실패했습니다. 잠시 후 다시 시도해 주세요.";
            regError.classList.remove('hidden');
        });
    });

    // Admin Dashboard Statistics and Searching
    const adminUserSelect = document.getElementById('admin-user-select');
    if (adminUserSelect) {
        adminUserSelect.addEventListener('change', () => {
            renderAdminHistory(lastHistoryList);
        });
    }

    const adminClubSelect = document.getElementById('admin-club-select');
    if (adminClubSelect) {
        adminClubSelect.addEventListener('change', () => {
            renderAdminHistory(lastHistoryList);
        });
    }

    const detailModeBtn = document.getElementById('admin-history-mode-detail-btn');
    const weekdayModeBtn = document.getElementById('admin-history-mode-weekday-btn');
    if (detailModeBtn && weekdayModeBtn) {
        detailModeBtn.addEventListener('click', () => {
            adminHistoryViewMode = 'detail';
            detailModeBtn.classList.add('active');
            weekdayModeBtn.classList.remove('active');
            renderAdminHistory(lastHistoryList);
        });
        weekdayModeBtn.addEventListener('click', () => {
            adminHistoryViewMode = 'weekday';
            weekdayModeBtn.classList.add('active');
            detailModeBtn.classList.remove('active');
            renderAdminHistory(lastHistoryList);
        });
    }

    // 가입 회원 권한·수정·삭제 및 요청사항 목록 렌더링은 js/admin-users-audit.js 로 분리됨 (v1.7.67)

    // ── 클럽 관리 · 대시보드 공유 상태 (js/admin-dashboard.js · js/admin-clubs.js 연동) ──
    let lastHistoryList = [];
    let historyLoaded = false; // globalHistory 최초 로드 완료 여부 — 로드 전 빈 리스트 기준으로 Firebase에 0을 써버리는 사고 방지
    let cachedDeletedIds = {}; // tombstone 캐시 — 어떤 경로로도 삭제된 항목이 보이지 않도록
    let selectedOverallClubs = null; // null = 전체 표시, Set이면 해당 클럽만 표시

    // 날짜 선택 직후 같은 클럽에 이미 등록된 정산 이력이 있는지 관리자 DB(globalHistory) 기준으로 즉시 확인해 팝업으로 안내한다.
    // 수정 중인 이력 자신은 제외하므로 기존 날짜를 그대로 유지해도 경고가 뜨지 않는다.
    const settlementDateInputForDuplicateCheck = document.getElementById('settlement-date-input');
    if (settlementDateInputForDuplicateCheck) {
        let _lastDuplicateCheckToken = 0;
        const handleDateDuplicateCheck = async (event) => {
            const selectedDate = event?.detail?.date || settlementDateInputForDuplicateCheck.value;
            if (!AppState.isLoggedIn || !selectedDate || (!AppState.clubId && !AppState.clubName)) return;
            const token = ++_lastDuplicateCheckToken;
            const duplicate = await AppState.checkDuplicateSettlement(AppState.clubId, AppState.clubName, selectedDate);
            if (token !== _lastDuplicateCheckToken || !duplicate) return;
            AppState.showDuplicateSettlementAlert(duplicate);
        };
        settlementDateInputForDuplicateCheck.addEventListener('settlement-date-selected', handleDateDuplicateCheck);
        settlementDateInputForDuplicateCheck.addEventListener('change', handleDateDuplicateCheck);
    }

    // 관리자 대시보드·사용 요약·연도 전환·이력 조회 UI는 js/admin-dashboard.js 로 분리됨 (v1.7.66)
    let adminHistoryViewMode = 'detail';
    const {
        renderAdminDashboard,
        updateAdminStartGuide,
        deleteAdminHistoryEntry,
        getAdminTheme,
        getChartThemeColors,
        applyAdminTheme,
        renderClubFilters,
        openClubUsageSummaryModal,
        openAttendanceRosterModal,
        updateGlobalYearPickerUI,
        selectQueryYear,
        openYearPickerModal,
        closeYearPickerModal,
        renderAdminHistory
    } = window.__installAdminDashboard({
        get firebaseDb() { return firebaseDb; },
        get lastHistoryList() { return lastHistoryList; },
        set lastHistoryList(v) { lastHistoryList = v; },
        get historyLoaded() { return historyLoaded; },
        set historyLoaded(v) { historyLoaded = v; },
        get cachedDeletedIds() { return cachedDeletedIds; },
        set cachedDeletedIds(v) { cachedDeletedIds = v; },
        get selectedOverallClubs() { return selectedOverallClubs; },
        set selectedOverallClubs(v) { selectedOverallClubs = v; },
        get _selectedQueryYear() { return _selectedQueryYear; },
        set _selectedQueryYear(v) { _selectedQueryYear = v; },
        get adminHistoryViewMode() { return adminHistoryViewMode; },
        renderFeedbackList,
        getRoleBadgeHtml,
        changeAdminUserRole,
        editAdminUser,
        deleteAdminUser
    });

    // 클럽 관리 UI는 js/admin-clubs.js 로 분리됨 (v1.7.49) — 원래 위치에서 동일 시점에 초기화
    window.__installAdminClubs({
        get historyLoaded() { return historyLoaded; },
        get lastHistoryList() { return lastHistoryList; },
        renderClubFilters,
        updateAdminStartGuide
    });

    // 만약 Firebase DB가 초기화되어 있지 않으면 로그인 버튼 숨기고 기본 오프라인 모드로 설정
    if (!firebaseDb) {
        switchToOfflineMode();
    } else {
        pinModal.classList.remove('hidden');
    }
});


// Diff popup notification helper
// 클럽별 "추가 배정" 금액 입력 팝업
function openAddClubBudgetModal(clubName, onConfirm) {
    const modal = document.getElementById('add-club-budget-modal');
    const titleEl = document.getElementById('add-club-budget-title');
    const input = document.getElementById('add-club-budget-input');
    const confirmBtn = document.getElementById('add-club-budget-confirm-btn');
    const cancelBtn = document.getElementById('add-club-budget-cancel-btn');
    if (!modal || !input || !confirmBtn || !cancelBtn) return;

    titleEl.textContent = `'${clubName}' 추가 배정 금액`;
    input.value = '';
    setupCurrencyInput(input);
    modal.classList.remove('hidden');
    input.focus();

    const close = () => modal.classList.add('hidden');
    const onConfirmClick = () => {
        const amount = parseAmount(input.value);
        close();
        onConfirm(amount);
    };
    confirmBtn.onclick = onConfirmClick;
    cancelBtn.onclick = close;
    // Enter = 확인, Escape = 취소 (onclick과 동일하게 속성 할당 방식 — 재오픈 시 리스너 누적 없음)
    input.onkeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); onConfirmClick(); }
        else if (e.key === 'Escape') { e.preventDefault(); close(); }
    };
}

function showDiffPopup(formula, diff) {
    const popup = document.getElementById('diff-popup');
    const formulaEl = document.getElementById('diff-popup-formula');
    if (!popup || !formulaEl) return;

    formulaEl.textContent = formula;
    popup.classList.remove('hidden', 'diff-positive', 'diff-negative');
    popup.classList.add(diff >= 0 ? 'diff-positive' : 'diff-negative');

    clearTimeout(popup._hideTimer);
}

// setCellValue / embedImagesIntoXlsx 는 js/export-reports.js 로 분리됨 (v1.7.49)

// 결제 카드 종류에 따라 입력 폼의 영수증/분리결제 영역을 표시/숨김 처리하고
// 분리 결제 시 개인카드 부담액(총금액 - 법인카드금액)을 자동 계산해 표시
function updateCardTypeUI() {
    const corpCheck = document.getElementById('expense-corp-check');
    const personalCheck = document.getElementById('expense-personal-check');
    const corpAmountGroup = document.getElementById('corp-amount-group');
    const personalAmountGroup = document.getElementById('personal-amount-group');
    const corpReceiptGroup = document.getElementById('corp-receipt-group');
    const personalReceiptGroup = document.getElementById('personal-receipt-group');
    const splitAutoHint = document.getElementById('split-auto-hint');
    const personalAmountInput = document.getElementById('expense-personal-amount-input');
    const corpAmountInput = document.getElementById('expense-corporate-amount-input');
    if (!corpCheck || !personalCheck) return;

    const corpOn = corpCheck.checked;
    const personalOn = personalCheck.checked;

    // 상품비: 반드시 법인카드만, 개인카드 사용 불가
    const category = (document.getElementById('expense-category-select') || {}).value || '';
    const isPrize = category === ExpenseCategory.PRIZE;

    const personalToggleLabel = personalCheck.closest ? personalCheck.closest('label') : null;
    if (isPrize) {
        corpCheck.checked = true;
        personalCheck.checked = false;
        personalCheck.disabled = true;
        if (personalToggleLabel) { personalToggleLabel.style.opacity = '0.35'; personalToggleLabel.style.pointerEvents = 'none'; }
        // 상품비: 법인카드 그룹만 표시, 개인카드 완전 숨김
        corpAmountGroup.classList.remove('hidden');
        personalAmountGroup.classList.add('hidden');
        corpReceiptGroup.classList.remove('hidden');
        personalReceiptGroup.classList.add('hidden');
        if (splitAutoHint) splitAutoHint.style.display = 'none';
        const total = parseAmount((document.getElementById('expense-amount-input') || {}).value || '0') || 0;
        const corpAmountInput = document.getElementById('expense-corporate-amount-input');
        if (corpAmountInput) {
            corpAmountInput.readOnly = false;
            corpAmountInput.style.opacity = '';
        }
        if (personalAmountInput) { personalAmountInput.value = '0'; }
        const corpExtraHint = document.getElementById('corp-extra-hint');
        if (corpExtraHint) corpExtraHint.style.display = 'none';
        updatePendingSelfPayPreview();
        return;
    } else {
        personalCheck.disabled = false;
        if (personalToggleLabel) { personalToggleLabel.style.opacity = ''; personalToggleLabel.style.pointerEvents = ''; }
    }

    if (!corpOn && !personalOn) {
        corpCheck.checked = true;
        return updateCardTypeUI();
    }

    const total = parseAmount((document.getElementById('expense-amount-input') || {}).value || '0') || 0;
    const corpExtraHint = document.getElementById('corp-extra-hint');

    if (corpOn) {
        corpAmountGroup.classList.remove('hidden');
        personalAmountGroup.classList.remove('hidden');
        corpReceiptGroup.classList.remove('hidden');
        personalReceiptGroup.classList.toggle('hidden', !personalOn);
        if (splitAutoHint) splitAutoHint.style.display = (personalOn && total > 0) ? '' : 'none';

        if (corpAmountInput) { corpAmountInput.readOnly = false; corpAmountInput.style.opacity = ''; }

        const corp = parseAmount(corpAmountInput ? corpAmountInput.value : '0') || 0;
        if (personalAmountInput) {
            personalAmountInput.value = total > 0 ? formatAmount(Math.max(total - corp, 0)) : '';
            personalAmountInput.readOnly = true;
            personalAmountInput.style.opacity = '0.65';
        }

        // 법인카드 구간 한도보다 적게 입력했을 때 추가 사용 가능 금액 안내
        if (corpExtraHint && total > 0) {
            const category = (document.getElementById('expense-category-select') || {}).value || 'EVENT';
            const corpLimit = _calcCorpForItem(total, category);
            const remaining = corpLimit - corp;
            if (remaining > 0 && corp < total) {
                corpExtraHint.textContent = `💳 ${formatAmount(remaining)}원 더 법인카드로 결제할 수 있습니다`;
                corpExtraHint.style.display = '';
            } else {
                corpExtraHint.style.display = 'none';
            }
        } else if (corpExtraHint) {
            corpExtraHint.style.display = 'none';
        }
    } else {
        corpAmountGroup.classList.add('hidden');
        personalAmountGroup.classList.remove('hidden');
        corpReceiptGroup.classList.add('hidden');
        personalReceiptGroup.classList.remove('hidden');
        if (splitAutoHint) splitAutoHint.style.display = 'none';

        if (corpAmountInput) { corpAmountInput.readOnly = false; corpAmountInput.style.opacity = ''; }
        if (personalAmountInput) {
            personalAmountInput.value = total > 0 ? formatAmount(total) : '';
            personalAmountInput.readOnly = true;
            personalAmountInput.style.opacity = '0.65';
        }
    }
    updatePendingSelfPayPreview();
}

let _manualPendingPerPerson = null;
let _isProgrammaticCardSync = false;

// 수동 입력된 인당 개인부담금을 바탕으로 이번 항목의 법인카드/개인카드 결제액을 역산하여 자동 배분
function applyManualPerPersonToCards(totalAmount, manualPerPerson, existingSelfPay, memberCount) {
    if (totalAmount <= 0 || memberCount <= 0) return;
    const corpCheck = document.getElementById('expense-corp-check');
    const personalCheck = document.getElementById('expense-personal-check');
    const corpAmountInput = document.getElementById('expense-corporate-amount-input');
    const personalAmountInput = document.getElementById('expense-personal-amount-input');
    if (!corpCheck || !personalCheck || !corpAmountInput || !personalAmountInput) return;

    // 사규 정책상 최소 1인당 자부담 계산 (사규 최소 기준 이하로 카드가 내려가지 않도록 안전 가드)
    const categorySelect = document.getElementById('expense-category-select');
    const currentCat = categorySelect ? categorySelect.value : 'EVENT';
    const rules = AppState.rules || DefaultRules;
    const editingId = AppState.editingItemId || null;
    const existingItems = (AppState.expenseItems || []).filter(item => item.id !== editingId);
    const allItemsForPolicy = [...existingItems, { amount: totalAmount, category: currentCat }];
    const policyResult = SettlementCalculator.calculate(memberCount, allItemsForPolicy, 0, rules);
    const minRequiredTotalSelfPay = Math.round(policyResult.totalSelfPay);
    const minRequiredPerPerson = Math.round(minRequiredTotalSelfPay / memberCount);

    const safeManualPerPerson = Math.max(minRequiredPerPerson, manualPerPerson);
    const targetTotalSelfPay = safeManualPerPerson * memberCount;
    // 이번 항목에서 개인카드로 부담해야 할 금액 = 목표 총 자부담 - 기존 항목들의 개인카드 합계
    let requiredItemPersonal = Math.max(0, targetTotalSelfPay - existingSelfPay);
    // 이번 항목 총액 내로 제한 (초과 시 전액 개인카드)
    requiredItemPersonal = Math.min(totalAmount, requiredItemPersonal);
    const requiredItemCorp = Math.max(0, totalAmount - requiredItemPersonal);

    _isProgrammaticCardSync = true;
    if (requiredItemPersonal > 0 && requiredItemCorp > 0) {
        corpCheck.checked = true;
        personalCheck.checked = true;
    } else if (requiredItemPersonal >= totalAmount) {
        corpCheck.checked = false;
        personalCheck.checked = true;
    } else {
        corpCheck.checked = true;
        personalCheck.checked = false;
    }

    corpAmountInput.value = formatAmount(requiredItemCorp);
    personalAmountInput.value = formatAmount(requiredItemPersonal);

    updateCardTypeUI();
    _isProgrammaticCardSync = false;
}

// 비용 항목 추가/수정 폼 입력 시 이번 금액이 반영되었을 때의 예상 총 자부담 및 1인당 개인부담 실시간 프리뷰
function updatePendingSelfPayPreview() {
    const previewEl = document.getElementById('pending-self-pay-preview');
    if (!previewEl) return;

    const amountInput = document.getElementById('expense-amount-input');
    const totalAmount = parseAmount(amountInput ? amountInput.value : '0') || 0;

    if (totalAmount <= 0) {
        previewEl.innerHTML = '';
        previewEl.classList.add('hidden');
        _manualPendingPerPerson = null;
        return;
    }

    const corpCheck = document.getElementById('expense-corp-check');
    const personalCheck = document.getElementById('expense-personal-check');
    const corpAmountInput = document.getElementById('expense-corporate-amount-input');

    const corpOn = corpCheck ? corpCheck.checked : true;
    const personalOn = personalCheck ? personalCheck.checked : false;

    let pendingItemCorp = 0;
    if (corpOn && !personalOn) {
        pendingItemCorp = totalAmount;
    } else if (!corpOn && personalOn) {
        pendingItemCorp = 0;
    } else if (corpOn && personalOn) {
        const rawCorp = parseAmount(corpAmountInput ? corpAmountInput.value : '0') || 0;
        pendingItemCorp = Math.min(totalAmount, Math.max(0, rawCorp));
    } else {
        pendingItemCorp = totalAmount;
    }
    const pendingItemPersonal = Math.max(0, totalAmount - pendingItemCorp);

    // 기존 등록된 항목들의 개인카드 자부담 합계 및 총 소요 비용 (수정 모드 시 수정 대상 항목은 제외)
    const editingId = AppState.editingItemId || null;
    const existingItems = (AppState.expenseItems || []).filter(item => item.id !== editingId);
    const existingSelfPay = existingItems.reduce((sum, item) => sum + (item.personalAmount || 0), 0);
    const existingTotalCost = existingItems.reduce((sum, item) => sum + (item.amount || 0), 0);

    const projectedTotalSelfPay = existingSelfPay + pendingItemPersonal;
    const projectedTotalCost = existingTotalCost + totalAmount;
    const projectedRatio = projectedTotalCost > 0 ? (projectedTotalSelfPay / projectedTotalCost * 100) : 0;
    const projectedRatioText = `${projectedRatio.toFixed(1)}%`;

    const memberCount = AppState.memberCount || (AppState.attendees ? AppState.attendees.length : 0);
    const autoPerPerson = memberCount > 0 ? Math.round(projectedTotalSelfPay / memberCount) : 0;
    const isManual = _manualPendingPerPerson !== null;
    const currentPerPerson = isManual ? _manualPendingPerPerson : autoPerPerson;

    // ── 사규 기준 최소 1인당 자부담 및 규정 구간 원인 계산 ──
    const categorySelect = document.getElementById('expense-category-select');
    const currentCat = categorySelect ? categorySelect.value : 'EVENT';
    const rules = AppState.rules || DefaultRules;

    const allItemsForPolicy = [...existingItems, { amount: totalAmount, category: currentCat }];
    const policyResult = SettlementCalculator.calculate(memberCount, allItemsForPolicy, 0, rules);
    const minRequiredTotalSelfPay = Math.round(policyResult.totalSelfPay);
    const minRequiredPerPerson = memberCount > 0 ? Math.round(minRequiredTotalSelfPay / memberCount) : 0;

    let policyReasonText = '';
    const pEventCost = policyResult.perPersonEventCost;
    if (pEventCost > rules.limit3) {
        policyReasonText = `라 구간(인당 최대 ${formatAmount(rules.deduction4 || 85000)}원 지원 한도 캡)`;
    } else if (pEventCost > rules.limit2) {
        policyReasonText = `다 구간(앞 ${formatAmount(rules.limit2)}원 20% + 초과분 ${Math.round((rules.rate3 || 0.4) * 100)}% 누진)`;
    } else if (pEventCost > rules.limit1) {
        policyReasonText = `나 구간(${Math.round((rules.rate2 || 0.2) * 100)}% 자부담)`;
    } else {
        policyReasonText = `가 구간(전액 지원)`;
    }

    // 만약 이미 DOM 요소들이 렌더링되어 있고 사용자가 인라인 입력창에 포커스를 두고 있다면,
    // input 엘리먼트를 새로 만들지 않고 값과 텍스트만 업데이트하여 포커스/타이핑을 유지한다.
    let perPersonInput = document.getElementById('pending-per-person-input');
    const isInputFocused = perPersonInput && document.activeElement === perPersonInput;

    if (perPersonInput && isInputFocused) {
        const totalSpan = previewEl.querySelector('.pending-total-val');
        if (totalSpan) totalSpan.textContent = `${formatAmount(projectedTotalSelfPay)}원`;
        const ratioSpan = previewEl.querySelector('.pending-ratio-val');
        if (ratioSpan) ratioSpan.textContent = projectedRatioText;
        const tagSpan = previewEl.querySelector('.manual-tag');
        if (isManual && !tagSpan) {
            const sub = previewEl.querySelector('.preview-sub');
            if (sub) {
                const newTag = document.createElement('span');
                newTag.className = 'manual-tag';
                newTag.textContent = '✍️ 1인당 자부담 직접 입력 반영됨';
                sub.appendChild(newTag);
            }
        }
        let resetBtn = document.getElementById('pending-per-person-reset-btn');
        if (isManual && !resetBtn) {
            const wrap = previewEl.querySelector('.pending-input-wrapper');
            if (wrap) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.id = 'pending-per-person-reset-btn';
                btn.className = 'pending-reset-btn';
                btn.title = '정책 자동계산값으로 복원';
                btn.textContent = '↺ 자동값';
                wrap.appendChild(btn);
                bindResetBtn(btn, totalAmount);
            }
        }
        return;
    }

    previewEl.className = projectedTotalSelfPay === 0 ? 'pending-self-pay-preview zero-self-pay' : 'pending-self-pay-preview';

    const inputHtml = memberCount > 0
        ? `<span class="pending-input-wrapper">
             <input type="text" inputmode="numeric" id="pending-per-person-input" class="pending-per-person-input" value="${formatAmount(currentPerPerson)}" placeholder="${formatAmount(autoPerPerson)}" title="1인당 원하는 자부담 금액(11,000원, 12,000원 등)을 직접 입력 시 카드 결제액이 자동 분할됩니다" />원
             ${isManual ? '<button type="button" id="pending-per-person-reset-btn" class="pending-reset-btn" title="정책 자동계산값으로 복원">↺ 자동값</button>' : ''}
           </span>`
        : `<strong>참석자 미등록</strong>`;

    previewEl.innerHTML = `
        <span class="preview-icon">${projectedTotalSelfPay === 0 ? '😊' : '💡'}</span>
        <div class="preview-content">
            <div class="preview-main-row">
                <strong>이번 금액 반영 시:</strong> 총 자부담 <strong class="pending-total-val">${formatAmount(projectedTotalSelfPay)}원</strong>
            </div>
            <div class="preview-personal-row">
                <span class="preview-personal-prefix">(1인당 자부담</span>
                ${inputHtml}
                <span class="preview-personal-suffix">)</span>
            </div>
            <div id="pending-per-person-error" class="pending-per-person-error hidden"></div>
            <div class="preview-sub">
                <span>예상 자부담 비율:</span> <strong class="pending-ratio-val">${projectedRatioText}</strong>
                ${isManual ? '<span class="manual-tag">✍️ 1인당 자부담 직접 입력 반영됨</span>' : ''}
            </div>
        </div>
    `;
    previewEl.classList.remove('hidden');

    perPersonInput = document.getElementById('pending-per-person-input');
    if (perPersonInput) {
        setupCurrencyInput(perPersonInput);

        const validateAndSync = (isCommit = false) => {
            const rawVal = perPersonInput.value.replace(/[^0-9]/g, '');
            const errorEl = document.getElementById('pending-per-person-error');

            if (rawVal === '') {
                _manualPendingPerPerson = null;
                if (errorEl) { errorEl.textContent = ''; errorEl.classList.add('hidden'); }
                perPersonInput.classList.remove('input-error');
                return;
            }

            let enteredVal = parseInt(rawVal, 10) || 0;

            if (minRequiredPerPerson > 0 && enteredVal < minRequiredPerPerson) {
                const errMsg = `⚠️ ${policyReasonText} 사규 규정에 따라 최소 1인당 ${formatAmount(minRequiredPerPerson)}원 이상 부담해야 합니다. (${formatAmount(minRequiredPerPerson)}원 미만 입력 불가)`;
                if (errorEl) {
                    errorEl.textContent = errMsg;
                    errorEl.classList.remove('hidden');
                }
                perPersonInput.classList.add('input-error');

                if (isCommit) {
                    enteredVal = minRequiredPerPerson;
                    perPersonInput.value = formatAmount(enteredVal);
                    perPersonInput.classList.remove('input-error');
                    if (errorEl) {
                        errorEl.textContent = `ℹ️ 사규 최소 기준인 ${formatAmount(minRequiredPerPerson)}원으로 자동 복원되었습니다.`;
                        setTimeout(() => { if (errorEl) errorEl.classList.add('hidden'); }, 3000);
                    }
                    _manualPendingPerPerson = enteredVal;
                    applyManualPerPersonToCards(totalAmount, enteredVal, existingSelfPay, memberCount);
                    updatePendingSelfPayPreview();
                } else {
                    applyManualPerPersonToCards(totalAmount, minRequiredPerPerson, existingSelfPay, memberCount);
                }
            } else {
                if (errorEl) { errorEl.textContent = ''; errorEl.classList.add('hidden'); }
                perPersonInput.classList.remove('input-error');
                _manualPendingPerPerson = enteredVal;
                applyManualPerPersonToCards(totalAmount, enteredVal, existingSelfPay, memberCount);
            }
        };

        perPersonInput.addEventListener('input', () => validateAndSync(false));
        perPersonInput.addEventListener('blur', () => validateAndSync(true));
        perPersonInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                validateAndSync(true);
                perPersonInput.blur();
            }
        });
    }

    const resetBtn = document.getElementById('pending-per-person-reset-btn');
    if (resetBtn) {
        bindResetBtn(resetBtn, totalAmount);
    }
}

function bindResetBtn(btn, totalAmount) {
    if (!btn || btn._bound) return;
    btn._bound = true;
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        _manualPendingPerPerson = null;
        const categorySelect = document.getElementById('expense-category-select');
        const cat = categorySelect ? categorySelect.value : 'EVENT';
        const defaultCorp = _calcCorpForItem(totalAmount, cat);
        const defaultPersonal = Math.max(0, totalAmount - defaultCorp);
        const corpAmountInput = document.getElementById('expense-corporate-amount-input');
        const personalAmountInput = document.getElementById('expense-personal-amount-input');
        const corpCheck = document.getElementById('expense-corp-check');
        const personalCheck = document.getElementById('expense-personal-check');
        if (corpAmountInput) corpAmountInput.value = formatAmount(defaultCorp);
        if (personalAmountInput) personalAmountInput.value = formatAmount(defaultPersonal);
        if (corpCheck) corpCheck.checked = defaultCorp > 0;
        if (personalCheck) personalCheck.checked = defaultPersonal > 0;
        updateCardTypeUI();
        updatePendingSelfPayPreview();
    });
}

// 행사비 인당 지원액이 정책 계산값(85,000원 이내 구간)을 초과할 때 이사진 승인 여부
// (모달에 응답하면 true — 항목 추가 완료 또는 법인카드 금액을 손으로 다시 바꾸면 초기화)
// 85,000원 자체를 초과하는 경우는 관리자가 클럽별로 사전 승인한 경우에만 자동 허용(v1.6.220) — 팝업 없음.
let _corpOverLimitApproved = false;

// 공통 모달 · 규정 안내 · 전역 툴팁 · 이미지 압축 유틸리티는 js/ui-modals.js 로 분리됨 (v1.7.68)

// 기존 항목 누적 + 클럽 잔여 예산 한도를 고려하여 신규/수정 항목의 법인카드 한도 계산
function _calcCorpForItem(amount, category) {
    const memberCount = AppState.memberCount || 0;
    const rules = AppState.rules || DefaultRules;
    if (amount <= 0) return 0;
    if (memberCount <= 0) return amount; // 인원 미설정 시 전액 법인

    // 클럽 잔여 예산 (이번 세션 이전까지 남은 예산 — 저장된 이력 기준)
    const clubBudget = AppState.getClubBudget ? AppState.getClubBudget() : 0;
    const clubUsed = AppState.getClubUsedBudget ? AppState.getClubUsedBudget() : 0;
    const availableBudgetTotal = clubBudget > 0 ? Math.max(0, clubBudget - clubUsed) : Infinity;

    // 현재 편집 중인 항목은 기존 항목에서 제외
    const editingId = AppState.editingItemId || null;
    const existingItems = (AppState.expenseItems || []).filter(item => item.id !== editingId);

    // 이번 세션에서 다른 항목에 이미 실제로 배정된 법인카드 금액(수동 조정분 포함, v1.6.215+ 실제 값 기준)
    // — 이걸 반영하지 않으면 관리자가 앞선 항목의 법인카드 금액을 정책 제안치보다 더 많이 수동 조정한 경우
    // (예: 예산 전액 소진) 뒤에 추가하는 항목에도 여전히 법인카드를 제안하는 오류가 생김
    const alreadyCorpAssigned = existingItems.reduce((s, it) => s + (it.corporateAmount || 0), 0);
    const realRemaining = availableBudgetTotal === Infinity
        ? Infinity
        : Math.max(0, availableBudgetTotal - alreadyCorpAssigned);

    // 시설·장비: 인원수와 무관하게 "정액성 비용"이라는 성격상 행사비 4구간 공식과는 별개로,
    // 항상 인당 rules.facilityLimit(기본 85,000원) × 참석 인원수까지만 법인카드, 초과분은 자부담
    // (카테고리 선택 시 뜨는 안내 팝업은 단순 알림일 뿐 이 계산 자체에는 영향을 주지 않는다. v1.6.232)
    // 한도는 정산 1건 전체 기준 — 같은 세션의 다른 시설비 항목에 이미 배정된 법인카드만큼 차감 (v1.6.233)
    if (category === ExpenseCategory.FACILITY) {
        const currentClubEntry = (AppState.clubId && AppState.clubRegistry && AppState.clubRegistry[AppState.clubId])
            ? AppState.clubRegistry[AppState.clubId]
            : (AppState.clubName && AppState.clubRegistry ? Object.values(AppState.clubRegistry).find(c => c.name === AppState.clubName) : null);
        // 관리자 [클럽 관리 > 시설 전액] 1회 승인된 클럽(또는 기존 승인 이력 수정 중)만 인당 85,000원 캡을 해제하고 잔여 예산 전액까지 법인카드 제안 (초과분은 개인카드 분배)
        if ((currentClubEntry && currentClubEntry.allowFacilityFullBudget) || (AppState.editingHistoryId && AppState._editingFacilityFullApproved)) {
            return Math.max(0, Math.min(amount, realRemaining));
        }
        const facilityCapTotal = memberCount * (rules.facilityLimit || 85000);
        const existingFacilityCorp = existingItems
            .filter(it => it.category === ExpenseCategory.FACILITY)
            .reduce((s, it) => s + (it.corporateAmount || 0), 0);
        const facilityCapLeft = Math.max(0, facilityCapTotal - existingFacilityCorp);
        return Math.max(0, Math.min(amount, facilityCapLeft, realRemaining));
    }

    const newItem = { amount, category };
    const allItems = [...existingItems, newItem];

    const resultAll = SettlementCalculator.calculate(memberCount, allItems, 0, rules);
    const resultExisting = existingItems.length > 0
        ? SettlementCalculator.calculate(memberCount, existingItems, 0, rules)
        : { finalSupportAmount: 0 };

    // 이 항목만의 정책상 적정 법인부담 추정치 (구간표 기반 한계기여분 — 예산과 무관한 "정책 제안치")
    const policyDelta = Math.max(0, resultAll.finalSupportAmount - resultExisting.finalSupportAmount);

    const corp = Math.min(policyDelta, realRemaining);
    return Math.max(0, Math.min(corp, amount));
}

// 금액·카테고리 변경 시 구간별 계산으로 법인/개인 토글 자동 설정 + 법인카드 금액 계산
function autoSetTogglesAndCorp() {
    const total = parseAmount((document.getElementById('expense-amount-input') || {}).value || '0') || 0;
    const category = (document.getElementById('expense-category-select') || {}).value || 'EVENT';
    const corpCheck = document.getElementById('expense-corp-check');
    const personalCheck = document.getElementById('expense-personal-check');
    const corpAmountInput = document.getElementById('expense-corporate-amount-input');
    if (!corpCheck || !personalCheck || !corpAmountInput) return;

    if (total <= 0) {
        corpCheck.checked = true;
        personalCheck.checked = false;
        corpAmountInput.value = '';
        return;
    }

    const corp = _calcCorpForItem(total, category);
    corpAmountInput.value = corp > 0 ? formatAmount(corp) : '';

    // 상품비: 반드시 법인카드만
    if (category === ExpenseCategory.PRIZE) {
        corpCheck.checked = true;
        personalCheck.checked = false;
    } else if (corp >= total) {
        corpCheck.checked = true;
        personalCheck.checked = false;
    } else if (corp > 0) {
        corpCheck.checked = true;
        personalCheck.checked = true;
    } else {
        corpCheck.checked = false;
        personalCheck.checked = true;
    }
}

// 법인카드 토글 수동 ON 시 금액만 재계산 (토글은 건드리지 않음)
function resetCorpAmount() {
    const corpCheck = document.getElementById('expense-corp-check');
    if (!corpCheck || !corpCheck.checked) return;
    const corpAmountInput = document.getElementById('expense-corporate-amount-input');
    if (!corpAmountInput) return;
    const total = parseAmount((document.getElementById('expense-amount-input') || {}).value || '0') || 0;
    const category = (document.getElementById('expense-category-select') || {}).value || 'EVENT';

    const corp = _calcCorpForItem(total, category);
    corpAmountInput.value = corp > 0 ? formatAmount(corp) : '';
}

// showEditModal / showConfirmModal / showAlertModal / showPrizeModal / 이미지 압축은 js/ui-modals.js 로 분리됨 (v1.7.68)
