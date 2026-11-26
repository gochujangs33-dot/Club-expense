// ============================================================
// js/admin-dashboard.js — 관리자 대시보드 · 사용 요약 · 연도 전환 · 이력 조회 UI 모듈
// ============================================================
// v1.7.66: app.js 에서 분리 (AGENTS.md §1-6 불변량 보존)
//   - renderAdminDashboard: loadClubRegistry() 재호출 금지, renderAllCharts 중복 호출 금지,
//     globalHistory .then() 에서 historyLoaded = true 세팅 및 renderClubManagement()/updateChartsBudgetStats() 유지
//   - deleteAdminHistoryEntry: globalHistory 기준 명부 누적 재계산 + 서버 증분 차감 + 감사 로그 기록
//   - window.__ChartBridge / createInlineClubUsageSummary / createInlineClubWeekdaySummary / YearPickerModal

window.__installAdminDashboard = function (B) {
    let adminDashboardRenderRequestId = 0;
    const ADMIN_HISTORY_SEEN_STORAGE_KEY = 'admin_history_seen_by_club';
    const ADMIN_THEME_STORAGE_KEY = 'club_expense_admin_theme';
    let attendanceRosterCopyText = '';
    let _availableQueryYears = [new Date().getFullYear()];
    let _cachedChartHistoryList = [];

    function renderAdminDashboard({ animateChartsOnLoad = false } = {}) {
        const firebaseDb = B.firebaseDb;
        if (!firebaseDb) return;
        const renderRequestId = ++adminDashboardRenderRequestId;

        if (typeof B.renderFeedbackList === 'function') B.renderFeedbackList();
        updateAdminStartGuide();

        // 1. Fetch Users
        firebaseDb.ref('users').once('value').then(snapshot => {
            const users = snapshot.val() || {};
            const tbody = document.getElementById('admin-users-list');
            tbody.innerHTML = '';

            // 레거시 000000 계정이 남아있다면 자동 정리 및 초기 회장/개발자 DB 필드 보장
            const dbCleanupUpdates = {};
            if (users['000000']) {
                dbCleanupUpdates['users/000000'] = null;
                delete users['000000'];
            }
            Object.keys(users).forEach(pin => {
                const u = users[pin];
                if (!u) return;
                const normRole = AppState.normalizeUserRole(u, pin);
                const normAdmin = AppState.checkHasAdminAccess(u, pin);
                if (u.role !== normRole || u.isAdmin !== normAdmin) {
                    dbCleanupUpdates[`users/${pin}/role`] = normRole;
                    dbCleanupUpdates[`users/${pin}/isAdmin`] = normAdmin;
                    u.role = normRole;
                    u.isAdmin = normAdmin;
                }
            });
            if (Object.keys(dbCleanupUpdates).length > 0) {
                firebaseDb.ref().update(dbCleanupUpdates).catch(() => {});
            }

            // 정렬: 회장 -> 개발자 -> 추가 관리자 -> 일반 회원 순, 그 다음 이름순
            const rolePriority = { president: 1, developer: 2, admin: 3, member: 4 };
            const sortedPins = Object.keys(users).sort((a, b) => {
                const rA = rolePriority[AppState.normalizeUserRole(users[a], a)] || 9;
                const rB = rolePriority[AppState.normalizeUserRole(users[b], b)] || 9;
                if (rA !== rB) return rA - rB;
                return String(users[a]?.name || '').localeCompare(String(users[b]?.name || ''), 'ko');
            });

            let userCount = 0;
            sortedPins.forEach(pin => {
                const user = users[pin];
                if (!user) return;
                userCount++;
                const role = AppState.normalizeUserRole(user, pin);
                const isAdminUser = AppState.checkHasAdminAccess(user, pin);
                const dateStr = user.registeredAt ? new Date(user.registeredAt).toLocaleDateString() : '-';
                const lastLoginStr = user.lastLoginAt
                    ? new Date(user.lastLoginAt).toLocaleString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                    : '-';
                const tr = document.createElement('tr');
                if (isAdminUser) {
                    tr.style.background = 'rgba(245, 158, 11, 0.04)';
                }
                const contactHtml = user.email
                    ? `<div style="font-size:0.72rem; color:var(--text-muted); margin-top:0.15rem;">✉️ ${AppState.escapeHtml(user.email)}</div>`
                    : '';
                const roleBadge = typeof B.getRoleBadgeHtml === 'function' ? B.getRoleBadgeHtml(role) : '';
                tr.innerHTML = `
                    <td>
                        <div style="display:inline-flex; align-items:center; flex-wrap:wrap;">
                            <strong>${AppState.escapeHtml(user.name)}</strong>
                            ${roleBadge}
                        </div>
                        ${contactHtml}
                    </td>
                    <td><code>${AppState.escapeHtml(pin)}</code></td>
                    <td>
                        <select class="user-role-select" data-pin="${AppState.escapeHtml(pin)}" data-name="${AppState.escapeHtml(user.name)}" style="padding:0.26rem 0.5rem; font-size:0.78rem; font-weight:${isAdminUser ? '700' : '500'}; border-radius:6px; border:1px solid ${isAdminUser ? 'rgba(245,158,11,0.45)' : 'var(--card-border)'}; background:var(--input-bg, transparent); color:${role === 'president' ? '#d97706' : (role === 'developer' ? '#0284c7' : (role === 'admin' ? '#059669' : 'var(--text-primary)'))}; cursor:pointer;">
                            <option value="member" ${role === 'member' ? 'selected' : ''}>👤 일반 회원</option>
                            <option value="president" ${role === 'president' ? 'selected' : ''}>👑 회장 (관리자)</option>
                            <option value="developer" ${role === 'developer' ? 'selected' : ''}>💻 개발자 (관리자)</option>
                            <option value="admin" ${role === 'admin' ? 'selected' : ''}>🛡️ 추가 관리자</option>
                        </select>
                    </td>
                    <td><span style="font-size:0.8rem; color:var(--text-muted);">${dateStr}</span></td>
                    <td><span style="font-size:0.78rem; color:var(--text-muted);">${lastLoginStr}</span></td>
                    <td style="white-space:nowrap;">
                        <button class="btn-edit-user btn-secondary" data-pin="${AppState.escapeHtml(pin)}" data-name="${AppState.escapeHtml(user.name)}" data-role="${AppState.escapeHtml(role)}" data-email="${AppState.escapeHtml(user.email || '')}" style="padding:0.3rem 0.6rem; font-size:0.78rem;">수정</button>
                        <button class="btn-delete-user btn-text-danger" data-pin="${AppState.escapeHtml(pin)}" data-name="${AppState.escapeHtml(user.name)}" style="padding:0.3rem 0.6rem; font-size:0.78rem;">삭제</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
            const totalUsersEl = document.getElementById('admin-total-users');
            if (totalUsersEl) totalUsersEl.textContent = `${userCount}명`;

            tbody.querySelectorAll('.user-role-select').forEach(selectEl => {
                selectEl.addEventListener('change', () => {
                    if (typeof B.changeAdminUserRole === 'function') {
                        B.changeAdminUserRole(
                            selectEl.getAttribute('data-pin'),
                            selectEl.getAttribute('data-name'),
                            selectEl.value,
                            selectEl
                        );
                    }
                });
            });
            tbody.querySelectorAll('.btn-edit-user').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (typeof B.editAdminUser === 'function') {
                        B.editAdminUser(
                            btn.getAttribute('data-pin'),
                            btn.getAttribute('data-name'),
                            btn.getAttribute('data-role') || 'member',
                            btn.getAttribute('data-email') || ''
                        );
                    }
                });
            });
            tbody.querySelectorAll('.btn-delete-user').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (typeof B.deleteAdminUser === 'function') {
                        B.deleteAdminUser(btn.getAttribute('data-pin'), btn.getAttribute('data-name'));
                    }
                });
            });
        });

        // 2. Fetch Global History (삭제 tombstone 필터링 포함)
        Promise.all([
            firebaseDb.ref('globalHistory').once('value'),
            firebaseDb.ref('deletedHistoryIds').once('value')
        ]).then(([snapshot, deletedSnap]) => {
            const historyData = snapshot.val() || {};
            const deletedIds = deletedSnap.val() || {};
            B.cachedDeletedIds = deletedIds;
            const historyList = extractValidGlobalHistory(historyData, deletedIds, firebaseDb)
                .sort(compareHistoryEntriesNewestFirst);

            let totalSpend = 0;
            let totalSupport = 0;
            let totalSelfPay = 0;

            historyList.forEach(entry => {
                totalSpend += entry.totalCost || 0;
                totalSupport += entry.finalSupportAmount || 0;
                totalSelfPay += entry.totalSelfPay || 0;
            });

            const adminSpendEl = document.getElementById('admin-total-spend');
            if (adminSpendEl) adminSpendEl.textContent = SettlementCalculator.formatCurrency(totalSpend);
            const adminSupportEl = document.getElementById('admin-total-support');
            if (adminSupportEl) adminSupportEl.textContent = SettlementCalculator.formatCurrency(totalSupport);
            const adminSelfPayEl = document.getElementById('admin-total-self-pay');
            if (adminSelfPayEl) adminSelfPayEl.textContent = SettlementCalculator.formatCurrency(totalSelfPay);

            renderAdminHistory(historyList);
            B.lastHistoryList = historyList;
            B.historyLoaded = true; // 최초 로드 완료 — 이후 renderClubManagement의 Firebase 동기화 허용
            // globalHistory 로드 후 클럽 관리 재렌더 — clubRegistry보다 늦게 로드되면 잔여예산이 0으로 표시되는 경쟁조건 해결
            if (typeof renderClubManagement === 'function') renderClubManagement();
            // 차트 예산 통계 타일도 최신 이력 기준으로 갱신 (첫 로드 시 0원 표시 방지)
            if (typeof updateChartsBudgetStats === 'function') updateChartsBudgetStats(historyList);
            // 차트 탭이 활성 상태인 경우 필터 포함 즉시 갱신
            const chartTabActive = document.getElementById('tab-charts') &&
                !document.getElementById('tab-charts').classList.contains('hidden');
            if (chartTabActive && typeof renderClubFilters === 'function') renderClubFilters();
            // 탭 진입 직후 rAF 렌더가 먼저 화면 크기를 잡고, 최신 Firebase 데이터가 도착한 이 최종 렌더에서만
            // 예약된 애니메이션을 소비한다. 두 렌더 모두 유지하되 모션이 중간에 덮어써지는 현상을 방지한다.
            // 앞 탭에서 시작된 오래된 요청이 뒤늦게 완료되면 최신 차트 모션을 덮어쓸 수 있으므로 차트만 재생성하지 않는다.
            const isLatestDashboardRequest = renderRequestId === adminDashboardRenderRequestId;
            if (!chartTabActive || isLatestDashboardRequest) {
                renderAllCharts(historyList, {
                    allowEntranceAnimation: chartTabActive && animateChartsOnLoad
                });
            }
        });

        // 3. 클럽 관리 UI 갱신 — loadClubRegistry()는 로그인 시 1회만 호출(실시간 리스너 유지)
        //    탭 전환 때마다 재호출하면 리스너가 누적되어 중복 클럽 생성 등 부작용 발생
        //    (renderAllCharts는 여기서 호출하지 않음 — 차트 탭 rAF 핸들러와 globalHistory .then이 담당,
        //     세 곳에서 중복 호출하면 탭 전환마다 차트가 3회 재생성되어 깜빡임 발생)
        if (typeof renderClubManagement === 'function') renderClubManagement();
        if (typeof updateChartsBudgetStats === 'function') updateChartsBudgetStats(B.lastHistoryList);
        renderClubFilters();
    }

    // 관리자 첫 진입 시 현재 설정 상태를 행동 중심으로 알려 준다.
    function updateAdminStartGuide() {
        const status = document.getElementById('admin-start-club-status');
        if (!status) return;
        const clubs = Object.values(AppState.clubRegistry || {})
            .filter(club => club && String(club.name || '').trim());
        if (clubs.length === 0) {
            status.textContent = '설정 필요 · 클럽을 먼저 등록해 주세요';
            status.style.color = '#fbbf24';
            return;
        }
        status.textContent = `등록 완료 · 현재 ${clubs.length}개 클럽`;
        status.style.color = '#5eead4';
    }

    function syncAdminStartActionState(cardId) {
        const card = document.getElementById(cardId);
        if (!card) return;
        const isOpen = !card.classList.contains('collapsed');
        document.querySelectorAll(`.admin-start-action[data-admin-target="${cardId}"]`).forEach(button => {
            button.setAttribute('aria-expanded', String(isOpen));
            button.classList.toggle('is-open', isOpen);
            const label = button.querySelector('.admin-start-toggle-label');
            if (label) label.textContent = isOpen ? '접기' : '열기';
        });
    }

    function toggleAdminStartCard(cardId) {
        const card = document.getElementById(cardId);
        if (!card) return;
        const shouldOpen = card.classList.contains('collapsed');
        card.classList.toggle('collapsed', !shouldOpen);
        localStorage.setItem(`card_collapsed_${cardId}`, shouldOpen ? '0' : '1');
        syncAdminStartActionState(cardId);
        if (!shouldOpen) return;
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setTimeout(() => {
            const input = card.querySelector('input:not([type="hidden"]), select');
            if (input) input.focus({ preventScroll: true });
        }, 350);
    }

    document.querySelectorAll('.admin-start-action').forEach(button => {
        button.addEventListener('click', () => {
            const action = button.dataset.adminAction;
            if (action === 'club') return toggleAdminStartCard('club-management-card');
            if (action === 'rules') return toggleAdminStartCard('rules-management-card');
            const tabButton = document.querySelector('.tab-nav .tab-btn[data-tab="tab-charts"]');
            if (tabButton) tabButton.click();
        });
    });
    syncAdminStartActionState('club-management-card');
    syncAdminStartActionState('rules-management-card');

    function getHistoryEntrySavedAt(entry) {
        const idTime = Number(entry?.id);
        if (Number.isFinite(idTime) && idTime > 100000000000) return idTime;
        const dateTime = new Date(entry?.date || entry?.settlementDate || 0).getTime();
        return Number.isFinite(dateTime) ? dateTime : 0;
    }

    function getAdminHistorySeenByClub() {
        try {
            const parsed = JSON.parse(localStorage.getItem(ADMIN_HISTORY_SEEN_STORAGE_KEY) || '{}');
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (_) {
            return {};
        }
    }

    function saveAdminHistorySeenByClub(seenByClub) {
        try {
            localStorage.setItem(ADMIN_HISTORY_SEEN_STORAGE_KEY, JSON.stringify(seenByClub));
        } catch (_) {}
    }

    // 정산 이력 삭제 (일반 회원·관리자 공용): 공유 이력·작성자 개인 이력·참석 누적·클럽 누적액을 함께 갱신하고 감사 로그에 기록한다.
    function deleteAdminHistoryEntry(entry, triggerButton) {
        const firebaseDb = B.firebaseDb;
        if (!AppState.isLoggedIn || !entry || !entry.id) return;
        showConfirmModal(
            `이 정산 기록을 삭제하시겠습니까?\n참석자 ${entry.memberCount}명의 누적 참석 횟수도 함께 차감되며, 삭제 기록은 로그에 남습니다.`,
            async () => {
                if (!firebaseDb) {
                    alert(t('alert.delete_failed_network'));
                    return;
                }

                if (triggerButton) triggerButton.disabled = true;
                try {
                    const id = entry.id;
                    // 사용자/관리자 어느 화면에서 삭제하든 전체 globalHistory 기준으로 명부 누적 횟수를 정확히 재계산한다.
                    const [historySnapshot, deletedSnapshot] = await Promise.all([
                        firebaseDb.ref('globalHistory').once('value'),
                        firebaseDb.ref('deletedHistoryIds').once('value')
                    ]);
                    const liveHistoryMap = historySnapshot.val() || {};
                    const liveDeletedMap = deletedSnapshot.val() || {};
                    const nextHistoryList = Object.values(liveHistoryMap)
                        .filter(historyEntry => historyEntry && !liveDeletedMap[String(historyEntry.id)] && String(historyEntry.id) !== String(id))
                        .sort(compareHistoryEntriesNewestFirst);
                    const pendingAdminDirUpdates = {};
                    const nextAdminDirectory = typeof AppState.prepareGlobalDirectorySync === 'function'
                        ? await AppState.prepareGlobalDirectorySync(nextHistoryList, pendingAdminDirUpdates)
                        : AppState.buildDirectoryCountsForHistory(nextHistoryList);
                    let creatorHistory = null;
                    let creatorDirectory = null;

                    // 작성자 개인 이력과 개인 명부 누적값도 함께 맞춘다.
                    if (entry.creatorPin) {
                        const creatorSnapshot = await firebaseDb.ref(`settlements/${entry.creatorPin}`).once('value');
                        const creatorData = creatorSnapshot.val() || {};
                        const rawHistory = creatorData.settlementHistory;
                        if (rawHistory) {
                            const historyArr = Array.isArray(rawHistory) ? rawHistory : Object.values(rawHistory);
                            creatorHistory = historyArr.filter(historyEntry => historyEntry && String(historyEntry.id) !== String(id));
                            if (String(entry.creatorPin) !== '000000' && creatorData.directory) {
                                creatorDirectory = AppState.buildDirectoryCountsForHistory(
                                    creatorHistory,
                                    creatorData.directory
                                );
                            }
                        }
                    }

                    // 현재 연도 이력 삭제분만 서버 증분으로 차감해 동시 정산 누적액을 덮어쓰지 않는다.
                    const currentYear = new Date().getFullYear();
                    const clubName = entry.clubName;
                    const clubId = entry.clubId;
                    const affectsCurrentYear = getHistoryEntryYear(entry) === currentYear;
                    const supportDelta = affectsCurrentYear ? -(entry.finalSupportAmount || 0) : 0;
                    const prizeDelta = affectsCurrentYear ? -getHistoryPrizeCost(entry) : 0;
                    const registryEntry = clubId
                        ? AppState.clubRegistry[clubId]
                        : Object.values(AppState.clubRegistry).find(club => club.name === clubName);
                    const registryClubId = clubId
                        || Object.keys(AppState.clubRegistry).find(key => AppState.clubRegistry[key] === registryEntry);

                    const firebaseUpdates = {
                        [`globalHistory/${id}`]: null,
                        [`deletedHistoryIds/${id}`]: true
                    };
                    if (Object.keys(pendingAdminDirUpdates).length > 0) {
                        Object.assign(firebaseUpdates, pendingAdminDirUpdates);
                    } else {
                        firebaseUpdates['settlements/000000/directory'] = nextAdminDirectory;
                    }
                    if (creatorHistory) {
                        firebaseUpdates[`settlements/${entry.creatorPin}/settlementHistory`] = AppState.buildPersonalHistoryForSync(creatorHistory);
                    }
                    if (creatorDirectory) {
                        firebaseUpdates[`settlements/${entry.creatorPin}/directory`] = creatorDirectory;
                    }
                    if (registryEntry && registryClubId) {
                        const delYearKey = String(getHistoryEntryYear(entry) || new Date().getFullYear());
                        const hasYearlyDelSnapshot = Boolean(
                            AppState.yearlyClubRegistry
                            && AppState.yearlyClubRegistry[delYearKey]
                            && AppState.yearlyClubRegistry[delYearKey][registryClubId]
                        );
                        if (prizeDelta !== 0) {
                            firebaseUpdates[`clubRegistry/${registryClubId}/prizeUsed`] = firebase.database.ServerValue.increment(prizeDelta);
                            if (hasYearlyDelSnapshot) {
                                firebaseUpdates[`yearlyClubRegistry/${delYearKey}/${registryClubId}/prizeUsed`] = firebase.database.ServerValue.increment(prizeDelta);
                                AppState.yearlyClubRegistry[delYearKey][registryClubId].prizeUsed = Math.max(0, (AppState.yearlyClubRegistry[delYearKey][registryClubId].prizeUsed || 0) + prizeDelta);
                            }
                        }
                        if (supportDelta !== 0) {
                            firebaseUpdates[`clubRegistry/${registryClubId}/usedBudget`] = firebase.database.ServerValue.increment(supportDelta);
                            if (hasYearlyDelSnapshot) {
                                firebaseUpdates[`yearlyClubRegistry/${delYearKey}/${registryClubId}/usedBudget`] = firebase.database.ServerValue.increment(supportDelta);
                                AppState.yearlyClubRegistry[delYearKey][registryClubId].usedBudget = Math.max(0, (AppState.yearlyClubRegistry[delYearKey][registryClubId].usedBudget || 0) + supportDelta);
                            }
                        }
                    }
                    AppState.appendAuditUpdate(firebaseUpdates, {
                        action: 'DELETE',
                        targetType: '정산 이력',
                        targetId: id,
                        targetLabel: `${entry.clubName || '기본 클럽'} ${entry.settlementDate || ''}`.trim(),
                        summary: `정산 이력 삭제: ${entry.clubName || '기본 클럽'} ${entry.settlementDate || ''}`.trim(),
                        clubId: registryClubId || entry.clubId || '',
                        clubName: entry.clubName || '',
                        details: {
                            작성자: `${entry.creatorName || '-'} (${entry.creatorPin || '-'})`,
                            정산일: entry.settlementDate || '',
                            총비용: entry.totalCost || 0,
                            지원금: entry.finalSupportAmount || 0,
                            자부담: entry.totalSelfPay || 0,
                            상품비: getHistoryPrizeCost(entry),
                            참석인원: entry.memberCount || 0
                        }
                    });
                    await firebaseDb.ref().update(firebaseUpdates);

                    const deletedCache = B.cachedDeletedIds || {};
                    deletedCache[String(id)] = true;
                    B.cachedDeletedIds = deletedCache;
                    B.lastHistoryList = nextHistoryList;
                    AppState.directory = nextAdminDirectory;
                    if (Array.isArray(AppState.clubHistory)) {
                        AppState.clubHistory = AppState.clubHistory.filter(h => h && String(h.id) !== String(id));
                    }
                    if (Array.isArray(AppState.settlementHistory)) {
                        AppState.settlementHistory = AppState.settlementHistory.filter(h => h && String(h.id) !== String(id));
                    }
                    if (creatorHistory && String(entry.creatorPin) === String(AppState.currentPin)) {
                        AppState.settlementHistory = creatorHistory;
                    }
                    if (registryEntry && registryClubId) {
                        const currentRegistryEntry = AppState.clubRegistry[registryClubId] || registryEntry;
                        currentRegistryEntry.prizeUsed = Math.max(0, (currentRegistryEntry.prizeUsed || 0) + prizeDelta);
                        currentRegistryEntry.usedBudget = Math.max(0, (currentRegistryEntry.usedBudget || 0) + supportDelta);
                    }
                    AppState.save(false);
                    AppState.render();
                    renderAdminHistory(nextHistoryList);
                    if (typeof renderClubManagement === 'function') renderClubManagement();
                    renderAllCharts(nextHistoryList);
                    if (typeof updateChartsBudgetStats === 'function') updateChartsBudgetStats(nextHistoryList);
                } catch (err) {
                    console.error('정산 이력 삭제 실패:', err);
                    alert(t('alert.delete_failed_network'));
                } finally {
                    if (triggerButton) triggerButton.disabled = false;
                }
            }
        );
    }

    // ── 전체 앱 Dark / Light 테마 (기기별 UI 선호값) ──────────────────
    function getAdminTheme() {
        try {
            return localStorage.getItem(ADMIN_THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
        } catch (_) {
            return 'dark';
        }
    }

    function getChartThemeColors() {
        const isLight = getAdminTheme() === 'light';
        return isLight
            ? {
                primary: '#17243b', secondary: '#53647e', muted: '#65748a',
                grid: 'rgba(72,91,128,0.12)', surface: '#f2f5f9', tooltip: '#17243b', tooltipText: '#f8fafc'
            }
            : {
                primary: '#e2e8f0', secondary: '#94a3b8', muted: '#64748b',
                grid: 'rgba(255,255,255,0.055)', surface: '#0f172a', tooltip: '#111827', tooltipText: '#f8fafc'
            };
    }

    function applyAdminTheme(theme, rerenderCharts = true) {
        const normalized = theme === 'light' ? 'light' : 'dark';
        try { localStorage.setItem(ADMIN_THEME_STORAGE_KEY, normalized); } catch (_) {}
        document.documentElement.dataset.appTheme = normalized;
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', normalized === 'light' ? '#e7ecf3' : '#8b5cf6');
        document.querySelectorAll('.admin-themed-pane').forEach(pane => {
            pane.dataset.adminTheme = normalized;
        });
        document.querySelectorAll('.admin-theme-btn').forEach(button => {
            const active = button.dataset.adminThemeValue === normalized;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        if (rerenderCharts && typeof renderAllCharts === 'function') {
            requestAnimationFrame(() => renderAllCharts(B.lastHistoryList || []));
        }
    }

    document.querySelectorAll('.admin-theme-btn').forEach(button => {
        button.addEventListener('click', () => applyAdminTheme(button.dataset.adminThemeValue));
    });
    applyAdminTheme(getAdminTheme(), false);

    // ── 차트 탭 - 클럽 선택 필터 칩 ──────────────────────────────────
    function renderClubFilters() {
        const container = document.getElementById('club-filter-container');
        if (!container) return;

        const clubs = Object.values(AppState.clubRegistry || {}).sort((a, b) => a.name.localeCompare(b.name));
        const allClubNames = clubs.map(c => c.name);
        const clubColorMap = getClubColorMap();

        if (!B.selectedOverallClubs) {
            B.selectedOverallClubs = new Set(allClubNames);
        } else {
            allClubNames.forEach(name => {
                if (!B.selectedOverallClubs.has(name) && !container.dataset.initialized) {
                    B.selectedOverallClubs.add(name);
                }
            });
        }
        const selectedOverallClubs = B.selectedOverallClubs;
        container.dataset.initialized = '1';

        const allSelected = allClubNames.length > 0 && allClubNames.every(name => selectedOverallClubs.has(name));

        let html = `
            <label class="club-filter-chip select-all ${allSelected ? 'active' : ''}">
                <input type="checkbox" data-overall-select-all ${allSelected ? 'checked' : ''}>
                전체 선택
            </label>
        `;
        clubs.forEach(club => {
            html += `
                <label class="club-filter-chip ${selectedOverallClubs.has(club.name) ? 'active' : ''}" style="--club-color:${clubColorMap[club.name]};">
                    <input type="checkbox" data-overall-filter value="${AppState.escapeHtml(club.name)}" ${selectedOverallClubs.has(club.name) ? 'checked' : ''}>
                    ${AppState.escapeHtml(club.name)}
                </label>
            `;
        });
        container.innerHTML = html;

        const selectAllInput = container.querySelector('input[data-overall-select-all]');
        if (selectAllInput) {
            selectAllInput.addEventListener('change', () => {
                if (selectAllInput.checked) {
                    allClubNames.forEach(name => selectedOverallClubs.add(name));
                } else {
                    selectedOverallClubs.clear();
                }
                renderClubFilters();
                renderAllCharts(B.lastHistoryList);
            });
        }

        container.querySelectorAll('input[data-overall-filter]').forEach(input => {
            input.addEventListener('change', () => {
                if (input.checked) {
                    selectedOverallClubs.add(input.value);
                } else {
                    selectedOverallClubs.delete(input.value);
                }
                renderClubFilters();
                renderAllCharts(B.lastHistoryList);
            });
        });
    }

    // 대시보드 차트 모듈(js/charts.js) 브리지 연결 (v1.7.48)
    window.__ChartBridge = {
        getCachedDeletedIds: () => B.cachedDeletedIds,
        getSelectedOverallClubs: () => B.selectedOverallClubs,
        getCachedChartHistoryList: () => _cachedChartHistoryList,
        setCachedChartHistoryList: (list) => { _cachedChartHistoryList = list; },
        getChartThemeColors: () => getChartThemeColors(),
        updateGlobalYearPickerUI: (year) => updateGlobalYearPickerUI(year),
        openClubUsageSummaryModal: (clubName, entries, year) => openClubUsageSummaryModal(clubName, entries, year),
        openAttendanceRosterModal: (title, summary, attendees) => openAttendanceRosterModal(title, summary, attendees),
        openSettlementDetailModal: (entry) => openSettlementDetailModal(entry),
        getHistoryUsageBreakdown: (entry) => getHistoryUsageBreakdown(entry)
    };

    function getHistoryCategoryCost(entry, category, legacyField) {
        const items = getHistoryExpenseItems(entry);
        if (items.length > 0) {
            return items
                .filter(item => item && item.category === category)
                .reduce((sum, item) => sum + Math.max(0, parseAmount(item.amount)), 0);
        }
        return Math.max(0, parseAmount(entry && entry[legacyField]));
    }

    function getHistoryUsageBreakdown(entry) {
        const eventCost = getHistoryCategoryCost(entry, ExpenseCategory.EVENT, 'eventCost');
        const facilityCost = getHistoryCategoryCost(entry, ExpenseCategory.FACILITY, 'facilityCost');
        const prizeCost = getHistoryPrizeCost(entry);
        const categoryTotal = eventCost + facilityCost + prizeCost;
        const hasTotal = Object.prototype.hasOwnProperty.call(entry || {}, 'totalCost');
        const totalCost = hasTotal ? Math.max(0, parseAmount(entry.totalCost)) : categoryTotal;
        const hasSelfPay = Object.prototype.hasOwnProperty.call(entry || {}, 'totalSelfPay');
        const selfPay = hasSelfPay ? Math.max(0, parseAmount(entry.totalSelfPay)) : 0;
        const hasSupport = Object.prototype.hasOwnProperty.call(entry || {}, 'finalSupportAmount');
        const support = hasSupport ? Math.max(0, parseAmount(entry.finalSupportAmount)) : Math.max(0, totalCost - selfPay);
        const memberCount = Number.isFinite(Number(entry && entry.memberCount))
            ? Number(entry.memberCount)
            : (entry && Array.isArray(entry.attendees) ? entry.attendees.length : 0);
        return { eventCost, facilityCost, prizeCost, totalCost, selfPay, support, memberCount };
    }

    function formatHistoryUsageDate(entry) {
        if (entry && /^\d{4}-\d{2}-\d{2}/.test(entry.settlementDate || '')) return entry.settlementDate.slice(0, 10);
        const rawDate = entry && (entry.date || entry.id);
        const date = rawDate ? new Date(rawDate) : null;
        if (!date || Number.isNaN(date.getTime())) return '-';
        return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    }

    function closeClubUsageSummaryModal() {
        document.getElementById('club-usage-summary-modal')?.classList.add('hidden');
    }

    function appendClubUsageTotalCard(container, label, amount, className = '', formatter = SettlementCalculator.formatCurrency) {
        const card = document.createElement('div');
        card.className = `club-usage-total-card ${className}`.trim();
        const labelEl = document.createElement('span');
        const valueEl = document.createElement('strong');
        labelEl.textContent = label;
        valueEl.textContent = formatter(amount);
        card.append(labelEl, valueEl);
        container.appendChild(card);
    }

    function getClubUsageSummaryData(clubName, entries, year = null) {
        const rows = (entries || [])
            .slice()
            .sort(compareHistoryEntriesNewestFirst)
            .map(entry => ({ entry, ...getHistoryUsageBreakdown(entry) }));
        const totals = rows.reduce((sum, row) => ({
            memberCount: sum.memberCount + row.memberCount,
            eventCost: sum.eventCost + row.eventCost,
            facilityCost: sum.facilityCost + row.facilityCost,
            prizeCost: sum.prizeCost + row.prizeCost,
            support: sum.support + row.support,
            selfPay: sum.selfPay + row.selfPay,
            totalCost: sum.totalCost + row.totalCost
        }), { memberCount: 0, eventCost: 0, facilityCost: 0, prizeCost: 0, support: 0, selfPay: 0, totalCost: 0 });
        const registryClub = Object.values(AppState.clubRegistry || {}).find(club => club && club.name === clubName);
        const hasAssignedBudget = Boolean(registryClub) && Object.prototype.hasOwnProperty.call(registryClub, 'budget');
        const clubBudget = registryClub ? Math.max(0, parseAmount(registryClub.budget)) : 0;
        const realCurrentYear = new Date().getFullYear();
        const isCurrentYearView = year === null || year === undefined || Number(year) === realCurrentYear;
        const priorUsed = (isCurrentYearView && registryClub) ? Math.max(0, parseAmount(registryClub.priorUsed)) : 0;
        const registryUsed = (isCurrentYearView && registryClub) ? Math.max(0, parseAmount(registryClub.usedBudget)) : 0;
        const clubUsed = priorUsed + Math.max(totals.support, registryUsed);
        const clubRemaining = clubBudget - clubUsed;
        return { rows, totals, hasAssignedBudget, clubBudget, clubRemaining };
    }

    function appendClubUsageRows(listEl, rows, year, { clickableAttendees = false, editableDates = false, excelDownloads = false, deleteEntries = false } = {}) {
        listEl.innerHTML = '';
        const columnLabels = ['행사 날짜', '참석 인원', '행사비', '시설·장비 이용료', '상품비', '회사 지원금', '자부담 비용', '총 비용'];
        if (rows.length === 0) {
            const row = document.createElement('tr');
            const cell = document.createElement('td');
            cell.colSpan = 8 + (excelDownloads ? 1 : 0) + (deleteEntries ? 1 : 0);
            cell.className = 'club-usage-summary-empty';
            cell.textContent = `${year}년 정산 이력이 없습니다.`;
            row.appendChild(cell);
            listEl.appendChild(row);
            return;
        }

        rows.forEach(rowData => {
            const row = document.createElement('tr');
            row.className = 'is-clickable-row';
            row.title = '클릭하여 정산 내역 및 참석자 명단 확인';
            row.addEventListener('click', event => {
                if (event.target.closest('button, a, input')) return;
                openSettlementDetailModal(rowData.entry);
            });
            const values = [
                formatHistoryUsageDate(rowData.entry),
                `${rowData.memberCount}명`,
                SettlementCalculator.formatCurrency(rowData.eventCost),
                SettlementCalculator.formatCurrency(rowData.facilityCost),
                SettlementCalculator.formatCurrency(rowData.prizeCost),
                SettlementCalculator.formatCurrency(rowData.support),
                SettlementCalculator.formatCurrency(rowData.selfPay),
                SettlementCalculator.formatCurrency(rowData.totalCost)
            ];
            values.forEach((value, index) => {
                const cell = document.createElement('td');
                cell.dataset.label = columnLabels[index];
                const canEdit = typeof editableDates === 'function'
                    ? editableDates(rowData.entry)
                    : editableDates;
                if (index === 0) {
                    const dateWrap = document.createElement('div');
                    dateWrap.className = 'club-usage-date-wrap';
                    if (canEdit) {
                        const dateButton = document.createElement('button');
                        dateButton.type = 'button';
                        dateButton.className = 'club-usage-date-button';
                        dateButton.textContent = value;
                        dateButton.title = '이 정산 이력 수정';
                        dateButton.addEventListener('click', event => {
                            event.stopPropagation();
                            AppState.loadHistoryEntryForEdit(rowData.entry);
                        });
                        dateWrap.appendChild(dateButton);
                    } else {
                        const dateSpan = document.createElement('span');
                        dateSpan.textContent = value;
                        dateWrap.appendChild(dateSpan);
                    }
                    if (rowData.entry.creatorName) {
                        const creatorBadge = document.createElement('div');
                        creatorBadge.className = 'club-usage-creator-badge';
                        creatorBadge.style.cssText = 'font-size:0.72rem; color:var(--text-muted); margin-top:0.25rem; font-weight:normal; letter-spacing:-0.02em; white-space:nowrap;';
                        creatorBadge.textContent = `👤 ${rowData.entry.creatorName}`;
                        creatorBadge.title = `정산인: ${rowData.entry.creatorName}${rowData.entry.creatorPin ? ` (PIN: ${rowData.entry.creatorPin})` : ''}`;
                        dateWrap.appendChild(creatorBadge);
                    }
                    cell.appendChild(dateWrap);
                } else if (index === 1 && clickableAttendees) {
                    const attendeeButton = document.createElement('button');
                    attendeeButton.type = 'button';
                    attendeeButton.className = 'club-usage-attendee-button';
                    attendeeButton.textContent = value;
                    attendeeButton.title = '참석자 명단 확인 및 복사';
                    attendeeButton.addEventListener('click', event => {
                        event.stopPropagation();
                        const date = formatHistoryUsageDate(rowData.entry);
                        openAttendanceRosterModal(
                            `${rowData.entry.clubName || '클럽'} ${date} 참석자 명단`,
                            `참석 ${rowData.memberCount}명`,
                            rowData.entry.attendees || []
                        );
                    });
                    cell.appendChild(attendeeButton);
                } else {
                    cell.textContent = value;
                }
                if (index === 5) cell.className = 'support';
                if (index === 6) cell.className = 'selfpay';
                row.appendChild(cell);
            });
            if (excelDownloads) {
                const excelCell = document.createElement('td');
                excelCell.dataset.label = '엑셀';
                const canDownload = typeof excelDownloads === 'function'
                    ? excelDownloads(rowData.entry)
                    : excelDownloads;
                if (canDownload) {
                    const excelButton = document.createElement('button');
                    excelButton.type = 'button';
                    excelButton.className = 'club-usage-excel-button';
                    excelButton.textContent = '엑셀';
                    excelButton.title = '이 정산 이력을 엑셀로 다시 받기';
                    excelButton.addEventListener('click', async () => {
                        excelButton.disabled = true;
                        excelButton.textContent = '생성 중';
                        try {
                            await AppState.downloadHistoryExcel(rowData.entry);
                        } finally {
                            excelButton.disabled = false;
                            excelButton.textContent = '엑셀';
                        }
                    });
                    excelCell.appendChild(excelButton);
                } else {
                    excelCell.textContent = '-';
                }
                row.appendChild(excelCell);
            }
            if (deleteEntries) {
                const deleteCell = document.createElement('td');
                deleteCell.dataset.label = '삭제';
                const canDelete = typeof deleteEntries === 'function'
                    ? deleteEntries(rowData.entry)
                    : deleteEntries;
                if (canDelete) {
                    const deleteButton = document.createElement('button');
                    deleteButton.type = 'button';
                    deleteButton.className = 'club-usage-delete-button';
                    deleteButton.textContent = '삭제';
                    deleteButton.title = '이 정산 이력 삭제';
                    deleteButton.addEventListener('click', () => deleteAdminHistoryEntry(rowData.entry, deleteButton));
                    deleteCell.appendChild(deleteButton);
                } else {
                    deleteCell.textContent = '-';
                }
                row.appendChild(deleteCell);
            }
            listEl.appendChild(row);
        });
    }

    function createInlineClubUsageSummary(clubName, entries, year, options = {}) {
        const { editableDates = false, excelDownloads = false, deleteEntries = false } = options;
        const data = getClubUsageSummaryData(clubName, entries, year);
        const summary = document.createElement('section');
        summary.className = 'inline-club-usage-summary';

        const totalsEl = document.createElement('div');
        totalsEl.className = 'club-usage-summary-totals';
        if (data.hasAssignedBudget) {
            appendClubUsageTotalCard(totalsEl, '클럽 총 예산', data.clubBudget, 'budget');
            appendClubUsageTotalCard(totalsEl, '현재 잔여 예산', data.clubRemaining, data.clubRemaining < 0 ? 'remaining over-budget' : 'remaining');
        } else {
            appendClubUsageTotalCard(totalsEl, '클럽 총 예산', 0, '', () => '미설정');
            appendClubUsageTotalCard(totalsEl, '현재 잔여 예산', 0, '', () => '미설정');
        }
        const rowCount = data.rows ? data.rows.length : 0;
        const avgAttendees = rowCount > 0 ? (data.totals.memberCount / rowCount) : 0;
        const avgAttendeesStr = `${avgAttendees % 1 === 0 ? avgAttendees : Number(avgAttendees.toFixed(1))}명`;
        appendClubUsageTotalCard(totalsEl, '평균 참석 인원', avgAttendees, '', () => avgAttendeesStr);
        appendClubUsageTotalCard(totalsEl, '총 상품비', data.totals.prizeCost, 'prize');
        appendClubUsageTotalCard(totalsEl, '총 회사 지원금', data.totals.support, 'support');
        const selfPayPct = data.totals.totalCost > 0
            ? ((data.totals.selfPay / data.totals.totalCost) * 100).toFixed(1)
            : '0.0';
        appendClubUsageTotalCard(totalsEl, '총 자부담 비용', data.totals.selfPay, 'selfpay',
            val => `${SettlementCalculator.formatCurrency(val)} (${selfPayPct}%)`);
        appendClubUsageTotalCard(totalsEl, '총 비용', data.totals.totalCost, '');

        const tableWrap = document.createElement('div');
        tableWrap.className = 'club-usage-summary-table-wrap inline-club-usage-table-wrap';
        const table = document.createElement('table');
        table.className = 'club-usage-summary-table';
        table.innerHTML = `
            <thead><tr>
                <th>행사 날짜</th><th>참석 인원</th><th>행사비</th><th>시설·장비 이용료</th><th>상품비</th><th>회사 지원금</th><th>자부담 비용</th><th>총 비용</th>${excelDownloads ? '<th>엑셀</th>' : ''}${deleteEntries ? '<th>삭제</th>' : ''}
            </tr></thead>`;
        const listEl = document.createElement('tbody');
        appendClubUsageRows(listEl, data.rows, year, { clickableAttendees: true, editableDates, excelDownloads, deleteEntries });
        table.appendChild(listEl);
        tableWrap.appendChild(table);
        summary.append(totalsEl, tableWrap);
        return summary;
    }
    window.createInlineClubUsageSummary = createInlineClubUsageSummary;

    // 클럽별 정산이력 요일별 요약 (모바일 친화적 뷰)
    function createInlineClubWeekdaySummary(clubName, entries, year, options = {}) {
        const data = getClubUsageSummaryData(clubName, entries, year);
        const summary = document.createElement('section');
        summary.className = 'inline-club-usage-summary inline-club-weekday-summary';

        const totalsEl = document.createElement('div');
        totalsEl.className = 'club-usage-summary-totals';
        if (data.hasAssignedBudget) {
            appendClubUsageTotalCard(totalsEl, '클럽 총 예산', data.clubBudget, 'budget');
            appendClubUsageTotalCard(totalsEl, '현재 잔여 예산', data.clubRemaining, data.clubRemaining < 0 ? 'remaining over-budget' : 'remaining');
        } else {
            appendClubUsageTotalCard(totalsEl, '클럽 총 예산', 0, '', () => '미설정');
            appendClubUsageTotalCard(totalsEl, '현재 잔여 예산', 0, '', () => '미설정');
        }
        const rowCount = data.rows ? data.rows.length : 0;
        const avgAttendees = rowCount > 0 ? (data.totals.memberCount / rowCount) : 0;
        const avgAttendeesStr = `${avgAttendees % 1 === 0 ? avgAttendees : Number(avgAttendees.toFixed(1))}명`;
        appendClubUsageTotalCard(totalsEl, '평균 참석 인원', avgAttendees, '', () => avgAttendeesStr);
        appendClubUsageTotalCard(totalsEl, '총 상품비', data.totals.prizeCost, 'prize');
        appendClubUsageTotalCard(totalsEl, '총 회사 지원금', data.totals.support, 'support');
        const selfPayPct = data.totals.totalCost > 0
            ? ((data.totals.selfPay / data.totals.totalCost) * 100).toFixed(1)
            : '0.0';
        appendClubUsageTotalCard(totalsEl, '총 자부담 비용', data.totals.selfPay, 'selfpay',
            val => `${SettlementCalculator.formatCurrency(val)} (${selfPayPct}%)`);
        appendClubUsageTotalCard(totalsEl, '총 비용', data.totals.totalCost, '');

        const DAY_DEFS = [
            { dayIdx: 1, name: '월', fullName: '월요일', isWeekend: false, color: '#38bdf8' },
            { dayIdx: 2, name: '화', fullName: '화요일', isWeekend: false, color: '#60a5fa' },
            { dayIdx: 3, name: '수', fullName: '수요일', isWeekend: false, color: '#818cf8' },
            { dayIdx: 4, name: '목', fullName: '목요일', isWeekend: false, color: '#a78bfa' },
            { dayIdx: 5, name: '금', fullName: '금요일', isWeekend: false, color: '#c084fc' },
            { dayIdx: 6, name: '토', fullName: '토요일', isWeekend: true,  color: '#fb923c' },
            { dayIdx: 0, name: '일', fullName: '일요일', isWeekend: true,  color: '#f87171' }
        ];

        const dayMap = {};
        DAY_DEFS.forEach(d => {
            dayMap[d.dayIdx] = {
                ...d,
                count: 0,
                attendees: 0,
                support: 0,
                selfPay: 0,
                totalCost: 0,
                rows: []
            };
        });

        data.rows.forEach(row => {
            const dateStr = formatHistoryUsageDate(row.entry);
            const parts = (dateStr || '').split('-');
            let dayIdx = -1;
            if (parts.length === 3) {
                const dt = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
                if (!isNaN(dt.getTime())) dayIdx = dt.getDay();
            }
            if (dayIdx >= 0 && dayMap[dayIdx]) {
                const target = dayMap[dayIdx];
                target.count++;
                target.attendees += row.memberCount;
                target.support += row.support;
                target.selfPay += row.selfPay;
                target.totalCost += row.totalCost;
                target.rows.push(row);
            }
        });

        const totalSettlements = data.rows.length;
        let maxCount = 0;
        let maxDays = [];
        let weekdayCount = 0;
        let weekendCount = 0;

        DAY_DEFS.forEach(d => {
            const st = dayMap[d.dayIdx];
            if (d.isWeekend) weekendCount += st.count;
            else weekdayCount += st.count;
            if (st.count > maxCount) {
                maxCount = st.count;
                maxDays = [d.fullName];
            } else if (st.count === maxCount && maxCount > 0) {
                maxDays.push(d.fullName);
            }
        });

        const weekdayWrap = document.createElement('div');
        weekdayWrap.className = 'club-weekday-summary-wrap';

        const banner = document.createElement('div');
        banner.className = 'club-weekday-summary-banner';
        if (totalSettlements > 0 && maxCount > 0) {
            const maxPct = Math.round((maxCount / totalSettlements) * 100);
            banner.innerHTML = `
                <div class="weekday-banner-item">
                    <span class="weekday-banner-icon">👑</span>
                    <div>
                        <div class="weekday-banner-title">최다 활동 요일</div>
                        <div class="weekday-banner-val"><strong>${maxDays.join(', ')}</strong> (${maxCount}회 · ${maxPct}%)</div>
                    </div>
                </div>
                <div class="weekday-banner-item">
                    <span class="weekday-banner-icon">📊</span>
                    <div>
                        <div class="weekday-banner-title">활동 분포</div>
                        <div class="weekday-banner-val">주중 ${weekdayCount}회 · 주말 ${weekendCount}회</div>
                    </div>
                </div>
            `;
        } else {
            banner.innerHTML = `
                <div class="weekday-banner-item" style="justify-content:center; width:100%;">
                    <span class="weekday-banner-icon">ℹ️</span>
                    <div class="weekday-banner-val">${year}년 정산 이력이 없습니다.</div>
                </div>
            `;
        }
        weekdayWrap.appendChild(banner);

        const listContainer = document.createElement('div');
        listContainer.className = 'club-weekday-list';

        DAY_DEFS.forEach(d => {
            const st = dayMap[d.dayIdx];
            const pct = totalSettlements > 0 ? Math.round((st.count / totalSettlements) * 100) : 0;
            const barWidth = maxCount > 0 ? Math.max(pct > 0 ? 8 : 0, Math.round((st.count / maxCount) * 100)) : 0;

            const rowCard = document.createElement('div');
            rowCard.className = `club-weekday-item ${st.count > 0 ? 'has-events' : 'no-events'}`;

            const headerRow = document.createElement('div');
            headerRow.className = 'club-weekday-header-row';

            const badgeWrap = document.createElement('div');
            badgeWrap.className = 'club-weekday-badge-wrap';
            badgeWrap.innerHTML = `
                <span class="club-weekday-badge" style="background:${d.isWeekend ? 'rgba(251,146,60,0.18)' : 'rgba(56,189,248,0.18)'}; color:${d.color}; border:1px solid ${d.color}40;">${d.name}</span>
                <span class="club-weekday-fullname">${d.fullName}</span>
            `;

            const statsWrap = document.createElement('div');
            statsWrap.className = 'club-weekday-stats-wrap';
            if (st.count > 0) {
                statsWrap.innerHTML = `
                    <span class="club-weekday-count-tag"><strong>${st.count}건</strong> (${pct}%)</span>
                    <span class="club-weekday-money-tag">지원 ${SettlementCalculator.formatCurrency(st.support)}</span>
                    <span class="club-weekday-toggle-arrow">▼</span>
                `;
            } else {
                statsWrap.innerHTML = `<span class="club-weekday-empty-tag">0건</span>`;
            }

            headerRow.append(badgeWrap, statsWrap);

            const progressWrap = document.createElement('div');
            progressWrap.className = 'club-weekday-progress-wrap';
            const progressBar = document.createElement('div');
            progressBar.className = 'club-weekday-progress-bar';
            progressBar.style.width = `${barWidth}%`;
            progressBar.style.background = `linear-gradient(90deg, ${d.color}cc, ${d.color})`;
            progressWrap.appendChild(progressBar);

            rowCard.append(headerRow, progressWrap);

            if (st.count > 0) {
                const detailWrap = document.createElement('div');
                detailWrap.className = 'club-weekday-detail-list hidden';

                st.rows.forEach(r => {
                    const itemEl = document.createElement('div');
                    itemEl.className = 'club-weekday-event-item';
                    itemEl.style.cursor = 'pointer';
                    itemEl.title = '클릭하여 정산 내역 및 참석자 확인';
                    itemEl.addEventListener('click', event => {
                        if (event.target.closest('button')) return;
                        openSettlementDetailModal(r.entry);
                    });

                    const dateBtn = document.createElement('button');
                    dateBtn.type = 'button';
                    dateBtn.className = 'club-usage-date-button';
                    dateBtn.textContent = formatHistoryUsageDate(r.entry);
                    if (options.editableDates) {
                        dateBtn.title = '이 정산 이력 수정';
                        dateBtn.addEventListener('click', () => AppState.loadHistoryEntryForEdit(r.entry));
                    }

                    const attBtn = document.createElement('button');
                    attBtn.type = 'button';
                    attBtn.className = 'club-usage-attendee-button';
                    attBtn.textContent = `${r.memberCount}명`;
                    attBtn.title = '참석자 명단 확인';
                    attBtn.addEventListener('click', () => {
                        const date = formatHistoryUsageDate(r.entry);
                        openAttendanceRosterModal(
                            `${r.entry.clubName || '클럽'} ${date} 참석자 명단`,
                            `참석 ${r.memberCount}명`,
                            r.entry.attendees || []
                        );
                    });

                    const infoSpan = document.createElement('span');
                    infoSpan.className = 'club-weekday-event-info';
                    infoSpan.innerHTML = `지원 <strong class="support">${SettlementCalculator.formatCurrency(r.support)}</strong> · 자부담 <strong class="selfpay">${SettlementCalculator.formatCurrency(r.selfPay)}</strong>`;

                    itemEl.append(dateBtn, attBtn, infoSpan);
                    detailWrap.appendChild(itemEl);
                });

                rowCard.appendChild(detailWrap);

                headerRow.style.cursor = 'pointer';
                headerRow.addEventListener('click', () => {
                    const isHidden = detailWrap.classList.toggle('hidden');
                    const arrow = headerRow.querySelector('.club-weekday-toggle-arrow');
                    if (arrow) arrow.textContent = isHidden ? '▼' : '▲';
                });
            }

            listContainer.appendChild(rowCard);
        });

        weekdayWrap.appendChild(listContainer);
        summary.append(totalsEl, weekdayWrap);
        return summary;
    }
    window.createInlineClubWeekdaySummary = createInlineClubWeekdaySummary;

    function openClubUsageSummaryModal(clubName, entries, year) {
        const modal = document.getElementById('club-usage-summary-modal');
        const titleEl = document.getElementById('club-usage-summary-title');
        const descriptionEl = document.getElementById('club-usage-summary-description');
        const totalsEl = document.getElementById('club-usage-summary-totals');
        const listEl = document.getElementById('club-usage-summary-list');
        if (!modal || !titleEl || !descriptionEl || !totalsEl || !listEl) return;

        const data = getClubUsageSummaryData(clubName, entries);

        titleEl.textContent = `${clubName} 사용 요약`;
        const yearText = year === '전체' ? '전체' : `${year}년`;
        descriptionEl.textContent = `${yearText} 정산 ${data.rows.length}건 · 행사별 비용 내역`;
        totalsEl.innerHTML = '';
        if (data.hasAssignedBudget) {
            appendClubUsageTotalCard(totalsEl, '클럽 총 예산', data.clubBudget, 'budget');
            appendClubUsageTotalCard(totalsEl, '현재 잔여 예산', data.clubRemaining, data.clubRemaining < 0 ? 'remaining over-budget' : 'remaining');
        } else {
            appendClubUsageTotalCard(totalsEl, '클럽 총 예산', 0, '', () => '미설정');
            appendClubUsageTotalCard(totalsEl, '현재 잔여 예산', 0, '', () => '미설정');
        }
        const rowCount = data.rows ? data.rows.length : 0;
        const avgAttendees = rowCount > 0 ? (data.totals.memberCount / rowCount) : 0;
        const avgAttendeesStr = `${avgAttendees % 1 === 0 ? avgAttendees : Number(avgAttendees.toFixed(1))}명`;
        appendClubUsageTotalCard(totalsEl, '평균 참석 인원', avgAttendees, '', () => avgAttendeesStr);
        appendClubUsageTotalCard(totalsEl, '총 상품비', data.totals.prizeCost, 'prize');
        appendClubUsageTotalCard(totalsEl, '총 회사 지원금', data.totals.support, 'support');
        appendClubUsageTotalCard(totalsEl, '총 자부담 비용', data.totals.selfPay, 'selfpay');
        appendClubUsageTotalCard(totalsEl, '총 비용', data.totals.totalCost, '');

        appendClubUsageRows(listEl, data.rows, year, { clickableAttendees: true });
        modal.classList.remove('hidden');
        document.getElementById('close-club-usage-summary-modal')?.focus();
    }

    function initClubUsageSummaryModal() {
        const modal = document.getElementById('club-usage-summary-modal');
        if (!modal) return;
        document.getElementById('close-club-usage-summary-modal')?.addEventListener('click', closeClubUsageSummaryModal);
        document.getElementById('dismiss-club-usage-summary-btn')?.addEventListener('click', closeClubUsageSummaryModal);
        modal.addEventListener('click', event => {
            if (event.target === modal) closeClubUsageSummaryModal();
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !modal.classList.contains('hidden')) closeClubUsageSummaryModal();
        });
    }
    initClubUsageSummaryModal();

    function closeAttendanceRosterModal() {
        document.getElementById('attendance-roster-modal')?.classList.add('hidden');
    }

    function openAttendanceRosterModal(title, summary, attendees) {
        const modal = document.getElementById('attendance-roster-modal');
        const titleEl = document.getElementById('attendance-roster-title');
        const summaryEl = document.getElementById('attendance-roster-summary');
        const listEl = document.getElementById('attendance-roster-list');
        const copyStatusEl = document.getElementById('attendance-roster-copy-status');
        const copyBtn = document.getElementById('copy-attendance-roster-btn');
        if (!modal || !titleEl || !summaryEl || !listEl || !copyStatusEl || !copyBtn) return;

        const people = normalizeChartAttendees(attendees);
        titleEl.textContent = title;
        summaryEl.textContent = summary;
        listEl.innerHTML = '';
        copyStatusEl.textContent = '';
        attendanceRosterCopyText = `${title}\n${summary}\n\n${people.map((person, index) => `${index + 1}. ${formatChartAttendee(person)}`).join('\n')}`;

        if (people.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'attendance-roster-empty';
            empty.textContent = '이 이력에는 참석자 상세 정보가 저장되지 않았습니다.';
            listEl.appendChild(empty);
            copyBtn.disabled = true;
        } else {
            people.forEach((person, index) => {
                const item = document.createElement('div');
                item.className = 'attendance-roster-person';
                item.textContent = `${index + 1}. ${formatChartAttendee(person)}`;
                listEl.appendChild(item);
            });
            copyBtn.disabled = false;
        }
        modal.classList.remove('hidden');
        document.getElementById('close-attendance-roster-modal')?.focus();
    }

    async function copyAttendanceRoster() {
        if (!attendanceRosterCopyText) return;
        const statusEl = document.getElementById('attendance-roster-copy-status');
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(attendanceRosterCopyText);
            } else {
                const textarea = document.createElement('textarea');
                textarea.value = attendanceRosterCopyText;
                textarea.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                textarea.remove();
            }
            if (statusEl) statusEl.textContent = '명단을 클립보드에 복사했습니다.';
        } catch (error) {
            console.error('참석자 명단 복사 실패:', error);
            if (statusEl) statusEl.textContent = '복사하지 못했습니다. 다시 시도해 주세요.';
        }
    }

    function initAttendanceRosterModal() {
        const modal = document.getElementById('attendance-roster-modal');
        if (!modal) return;
        document.getElementById('close-attendance-roster-modal')?.addEventListener('click', closeAttendanceRosterModal);
        document.getElementById('dismiss-attendance-roster-btn')?.addEventListener('click', closeAttendanceRosterModal);
        document.getElementById('copy-attendance-roster-btn')?.addEventListener('click', copyAttendanceRoster);
        modal.addEventListener('click', event => {
            if (event.target === modal) closeAttendanceRosterModal();
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !modal.classList.contains('hidden')) closeAttendanceRosterModal();
        });
    }
    initAttendanceRosterModal();

    let settlementDetailCopyText = '';

    function closeSettlementDetailModal() {
        document.getElementById('settlement-detail-modal')?.classList.add('hidden');
    }

    function openSettlementDetailModal(entry) {
        if (!entry || typeof entry !== 'object') return;
        const modal = document.getElementById('settlement-detail-modal');
        const titleEl = document.getElementById('settlement-detail-title');
        const metaEl = document.getElementById('settlement-detail-meta');
        const totalsEl = document.getElementById('settlement-detail-totals');
        const itemsEl = document.getElementById('settlement-detail-items');
        const attCountEl = document.getElementById('settlement-detail-attendee-count');
        const attListEl = document.getElementById('settlement-detail-attendees');
        const copyStatusEl = document.getElementById('settlement-detail-copy-status');
        const copyBtn = document.getElementById('copy-settlement-detail-roster-btn');
        const editBtn = document.getElementById('edit-from-settlement-detail-btn');
        if (!modal || !titleEl || !metaEl || !totalsEl || !itemsEl || !attCountEl || !attListEl) return;

        const clubName = entry.clubName || '기본 클럽';
        const dateText = formatHistoryUsageDate(entry);
        const breakdown = getHistoryUsageBreakdown(entry);
        const perPersonSelfPay = breakdown.memberCount > 0
            ? Math.round(breakdown.selfPay / breakdown.memberCount)
            : Math.max(0, parseAmount(entry.perPersonSelfPay));

        titleEl.textContent = `${clubName} · ${dateText} 정산 내역`;

        const savedAtRaw = entry.date || (entry.id ? Number(entry.id) : null);
        const savedAtDate = savedAtRaw ? new Date(savedAtRaw) : null;
        const savedAtText = savedAtDate && !Number.isNaN(savedAtDate.getTime())
            ? `${savedAtDate.getFullYear()}-${String(savedAtDate.getMonth() + 1).padStart(2, '0')}-${String(savedAtDate.getDate()).padStart(2, '0')} ${String(savedAtDate.getHours()).padStart(2, '0')}:${String(savedAtDate.getMinutes()).padStart(2, '0')}`
            : '-';

        metaEl.innerHTML = [
            `<span>행사일: <strong>${AppState.escapeHtml(dateText)}</strong></span>`,
            `<span>입력 일시: <strong>${AppState.escapeHtml(savedAtText)}</strong></span>`,
            `<span>정산인: <strong>${AppState.escapeHtml(entry.creatorName || '-')}</strong></span>`,
            entry.eventNote ? `<span>비고: <strong>${AppState.escapeHtml(entry.eventNote)}</strong></span>` : ''
        ].filter(Boolean).join('');

        totalsEl.innerHTML = '';
        appendClubUsageTotalCard(totalsEl, '총 비용', breakdown.totalCost, '');
        appendClubUsageTotalCard(totalsEl, '회사 지원금(법인)', breakdown.support, 'support');
        appendClubUsageTotalCard(totalsEl, '자부담 비용(개인)', breakdown.selfPay, 'selfpay');
        appendClubUsageTotalCard(totalsEl, '인당 자부담', perPersonSelfPay, '');

        itemsEl.innerHTML = '';
        const items = getHistoryExpenseItems(entry);
        const catNames = (typeof categoryNameMap !== 'undefined' && categoryNameMap)
            ? categoryNameMap
            : { EVENT: '행사비', FACILITY: '시설·장비 이용료', PRIZE: '상품' };
        if (items.length === 0) {
            const emptyItem = document.createElement('p');
            emptyItem.className = 'attendance-roster-empty';
            emptyItem.textContent = '등록된 세부 비용 항목이 없습니다.';
            itemsEl.appendChild(emptyItem);
        } else {
            items.forEach(item => {
                const row = document.createElement('div');
                row.className = 'settlement-detail-item-row';
                const totalAmt = Math.max(0, parseAmount(item.amount));
                const corpAmt = (item.corporateAmount !== undefined && item.corporateAmount !== null)
                    ? Math.max(0, parseAmount(item.corporateAmount))
                    : (item.cardType === 'personal' ? 0 : totalAmt);
                const persAmt = (item.personalAmount !== undefined && item.personalAmount !== null)
                    ? Math.max(0, parseAmount(item.personalAmount))
                    : Math.max(0, totalAmt - corpAmt);
                const catLabel = catNames[item.category] || item.category || '기타';
                row.innerHTML = `
                    <div class="settlement-detail-item-left">
                        <span class="settlement-detail-item-cat">${AppState.escapeHtml(catLabel)}</span>
                        <strong>${AppState.escapeHtml(item.description || '항목')}</strong>
                    </div>
                    <div class="settlement-detail-item-right">
                        <strong>${SettlementCalculator.formatCurrency(totalAmt)}</strong>
                        <small>법인 ${SettlementCalculator.formatCurrency(corpAmt)} · 개인 ${SettlementCalculator.formatCurrency(persAmt)}</small>
                    </div>
                `;
                itemsEl.appendChild(row);
            });
        }

        const people = normalizeChartAttendees(entry.attendees || []);
        attCountEl.textContent = String(people.length || breakdown.memberCount);
        attListEl.innerHTML = '';
        if (copyStatusEl) copyStatusEl.textContent = '';
        settlementDetailCopyText = `${clubName} ${dateText} 참석자 명단 (${people.length}명)\n\n${people.map((p, i) => `${i + 1}. ${formatChartAttendee(p)}`).join('\n')}`;

        if (people.length === 0) {
            const emptyAtt = document.createElement('p');
            emptyAtt.className = 'attendance-roster-empty';
            emptyAtt.textContent = '이 이력에는 참석자 상세 정보가 저장되지 않았습니다.';
            attListEl.appendChild(emptyAtt);
            if (copyBtn) copyBtn.disabled = true;
        } else {
            people.forEach((person, index) => {
                const pEl = document.createElement('div');
                pEl.className = 'attendance-roster-person';
                pEl.textContent = `${index + 1}. ${formatChartAttendee(person)}`;
                attListEl.appendChild(pEl);
            });
            if (copyBtn) copyBtn.disabled = false;
        }

        if (editBtn) {
            const canEdit = Boolean(AppState.isAdmin && AppState.isAdmin())
                || (entry.creatorPin && AppState.currentPin && String(entry.creatorPin) === String(AppState.currentPin));
            editBtn.classList.toggle('hidden', !canEdit);
            editBtn.onclick = () => {
                closeSettlementDetailModal();
                closeClubUsageSummaryModal();
                AppState.loadHistoryEntryForEdit(entry);
            };
        }

        modal.classList.remove('hidden');
        document.getElementById('close-settlement-detail-modal')?.focus();
    }
    window.openSettlementDetailModal = openSettlementDetailModal;

    function initSettlementDetailModal() {
        const modal = document.getElementById('settlement-detail-modal');
        if (!modal) return;
        document.getElementById('close-settlement-detail-modal')?.addEventListener('click', closeSettlementDetailModal);
        document.getElementById('dismiss-settlement-detail-btn')?.addEventListener('click', closeSettlementDetailModal);
        document.getElementById('copy-settlement-detail-roster-btn')?.addEventListener('click', async () => {
            if (!settlementDetailCopyText) return;
            const statusEl = document.getElementById('settlement-detail-copy-status');
            try {
                if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(settlementDetailCopyText);
                }
                if (statusEl) statusEl.textContent = '참석자 명단을 클립보드에 복사했습니다.';
            } catch (err) {
                if (statusEl) statusEl.textContent = '복사하지 못했습니다. 다시 시도해 주세요.';
            }
        });
        modal.addEventListener('click', event => {
            if (event.target === modal) closeSettlementDetailModal();
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !modal.classList.contains('hidden')) closeSettlementDetailModal();
        });
    }
    initSettlementDetailModal();

    // ── 전역 조회 연도 상태 관리 & 팝업 모달 (v1.6.331) ──────────────────────
    function updateGlobalYearPickerUI(year) {
        const yrStr = String(year);
        B._selectedQueryYear = yrStr;
        window._selectedQueryYear = yrStr;
        const labelEl = document.getElementById('global-year-picker-label');
        if (labelEl) {
            labelEl.textContent = yrStr === 'ALL' ? '전체' : yrStr;
        }
        const hiddenSelect = document.getElementById('charts-year-select');
        if (hiddenSelect) hiddenSelect.value = yrStr;
        const adminHiddenSelect = document.getElementById('admin-history-year-select');
        if (adminHiddenSelect) adminHiddenSelect.value = yrStr;
        const userHiddenSelect = document.getElementById('user-history-year-select');
        if (userHiddenSelect) userHiddenSelect.value = yrStr;
    }

    function renderYearPickerModalList(historyList) {
        const listEl = document.getElementById('year-picker-list');
        if (!listEl) return;

        const effectiveList = (historyList && historyList.length ? historyList : (_cachedChartHistoryList && _cachedChartHistoryList.length ? _cachedChartHistoryList : (window.AppState && window.AppState.globalHistory ? window.AppState.globalHistory : []))) || [];
        const deletedCache = B.cachedDeletedIds || {};
        const cleanList = effectiveList.filter(e => e && !deletedCache[String(e.id)]);

        // DB에 등록된 실제 연도 + 차년도(예: 2027년) + yearlyRules 등록 연도 추출
        const yearsSet = new Set(
            cleanList.map(e => getHistoryEntryYear(e)).filter(y => y && !isNaN(y))
        );
        const thisYear = new Date().getFullYear();
        yearsSet.add(thisYear);
        yearsSet.add(thisYear + 1);
        Object.keys((window.AppState && window.AppState.yearlyRules) || {}).forEach(k => {
            const y = Number(k);
            if (!Number.isNaN(y) && y >= 2020 && y <= 2040) yearsSet.add(y);
        });

        _availableQueryYears = Array.from(yearsSet).sort((a, b) => b - a);
        const activeYear = B._selectedQueryYear || String(thisYear);

        let html = '';
        _availableQueryYears.forEach(y => {
            const count = cleanList.filter(e => getHistoryEntryYear(e) === y).length;
            const isSelected = activeYear === String(y);
            html += `
                <button type="button" class="year-picker-item-btn ${isSelected ? 'selected' : ''}" data-year="${y}">
                    <span>${y}년 정산 자료</span>
                    <span class="year-picker-item-badge">${count}건 ${isSelected ? '✓' : ''}</span>
                </button>
            `;
        });

        const totalCount = cleanList.length;
        const isAllSelected = activeYear === 'ALL';
        html += `
            <button type="button" class="year-picker-item-btn ${isAllSelected ? 'selected' : ''}" data-year="ALL">
                <span>전체 연도 정산 자료 (누적)</span>
                <span class="year-picker-item-badge">총 ${totalCount}건 ${isAllSelected ? '✓' : ''}</span>
            </button>
        `;

        listEl.innerHTML = html;

        listEl.querySelectorAll('.year-picker-item-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const chosen = btn.dataset.year;
                selectQueryYear(chosen);
            });
        });
    }

    function selectQueryYear(year) {
        updateGlobalYearPickerUI(year);
        closeYearPickerModal();
        if (window.AppState && typeof window.AppState.syncActiveClubStateForQueryYear === 'function') {
            window.AppState.syncActiveClubStateForQueryYear(true);
        }
        if (typeof window._onYearlyRulesUpdate === 'function') {
            window._onYearlyRulesUpdate();
        }
        const listToRender = (_cachedChartHistoryList && _cachedChartHistoryList.length)
            ? _cachedChartHistoryList
            : (window.AppState && window.AppState.globalHistory ? window.AppState.globalHistory : []);
        if (typeof renderAllCharts === 'function') {
            renderAllCharts(listToRender);
        }
        if (typeof renderAdminHistory === 'function') {
            renderAdminHistory(listToRender);
        }
        if (typeof renderClubManagement === 'function') {
            renderClubManagement();
        }
        if (typeof updateChartsBudgetStats === 'function') {
            updateChartsBudgetStats(listToRender);
        }
        if (window.AppState && typeof window.AppState.render === 'function') {
            window.AppState.render();
        }
        if (typeof window.refreshRegularMembersModalIfOpen === 'function') {
            window.refreshRegularMembersModalIfOpen();
        }
        if (typeof showToast === 'function') {
            showToast(`${year === 'ALL' ? '전체 연도' : year + '년'} 정산 자료로 조회합니다.`);
        }
    }

    function openYearPickerModal() {
        const modal = document.getElementById('year-picker-modal');
        if (!modal) return;
        const listForModal = (_cachedChartHistoryList && _cachedChartHistoryList.length)
            ? _cachedChartHistoryList
            : (window.AppState && window.AppState.globalHistory ? window.AppState.globalHistory : []);
        renderYearPickerModalList(listForModal);
        modal.style.display = 'flex';
    }

    function closeYearPickerModal() {
        const modal = document.getElementById('year-picker-modal');
        if (modal) modal.style.display = 'none';
    }

    function initYearPickerModal() {
        const btn = document.getElementById('global-year-picker-btn');
        if (btn && !btn._hasClickListener) {
            btn.addEventListener('click', openYearPickerModal);
            btn._hasClickListener = true;
        }

        const closeBtn = document.getElementById('close-year-picker-modal-btn');
        if (closeBtn && !closeBtn._hasClickListener) {
            closeBtn.addEventListener('click', closeYearPickerModal);
            closeBtn._hasClickListener = true;
        }

        const cancelBtn = document.getElementById('cancel-year-picker-modal-btn');
        if (cancelBtn && !cancelBtn._hasClickListener) {
            cancelBtn.addEventListener('click', closeYearPickerModal);
            cancelBtn._hasClickListener = true;
        }

        const modal = document.getElementById('year-picker-modal');
        if (modal && !modal._hasClickListener) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeYearPickerModal();
            });
            modal._hasClickListener = true;
        }

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal && modal.style.display !== 'none') {
                closeYearPickerModal();
            }
        });
    }
    initYearPickerModal();

    // HTML 인라인 onclick 이벤트용 전역 바인딩
    window.openYearPickerModal = openYearPickerModal;
    window.closeYearPickerModal = closeYearPickerModal;
    window.selectQueryYear = selectQueryYear;

    // 클럽별 정산이력 탭 - 특정 클럽 선택 드롭다운
    function renderAdminClubSelect(allClubNames) {
        const select = document.getElementById('admin-club-select');
        const group = document.getElementById('admin-club-select-group');
        if (!select || !group) return;
        const current = select.value;
        const names = [...new Set((allClubNames || []).filter(Boolean))].sort((a, b) => a.localeCompare(b));
        select.innerHTML = `<option value="">전체 클럽</option>` +
            names.map(n => `<option value="${AppState.escapeHtml(n)}">${AppState.escapeHtml(n)}</option>`).join('');
        select.value = names.includes(current) ? current : '';
    }

    // 클럽별 정산이력 탭 - 정산인(사용자) 선택 드롭다운
    function renderAdminUserSelect(historyList) {
        const select = document.getElementById('admin-user-select');
        const group = document.getElementById('admin-user-select-group');
        if (!select || !group) return;
        const current = select.value;
        const names = [...new Set((historyList || []).map(e => e.creatorName).filter(Boolean))].sort((a, b) => a.localeCompare(b));
        if (names.length <= 1) {
            group.classList.add('hidden');
            select.innerHTML = `<option value="">전체 사용자</option>`;
            select.value = '';
            return;
        }
        group.classList.remove('hidden');
        select.innerHTML = `<option value="">전체 사용자</option>` +
            names.map(n => `<option value="${AppState.escapeHtml(n)}">${AppState.escapeHtml(n)}</option>`).join('');
        select.value = names.includes(current) ? current : '';
    }

    function renderAdminHistory(rawHistoryList) {
        const deletedCache = B.cachedDeletedIds || {};
        // tombstone 캐시로 항상 한 번 더 필터링 — 어떤 경로로 복원돼도 화면에 표시 안 됨
        const historyList = (rawHistoryList || [])
            .filter(e => e && !deletedCache[String(e.id)])
            .sort(compareHistoryEntriesNewestFirst);
        const container = document.getElementById('admin-history-container');
        if (!container) return;

        // 클럽 목록 및 정산인 목록 드롭다운 갱신
        const allKnownClubNames = Object.values(AppState.clubRegistry || {})
            .map(club => club && club.name)
            .filter(Boolean);
        historyList.forEach(e => {
            if (e && e.clubName && !allKnownClubNames.includes(e.clubName)) {
                allKnownClubNames.push(e.clubName);
            }
        });
        renderAdminClubSelect(allKnownClubNames);
        renderAdminUserSelect(historyList);

        const clubSelect = document.getElementById('admin-club-select');
        const selectedClub = clubSelect ? clubSelect.value : '';
        const userSelect = document.getElementById('admin-user-select');
        const selectedUser = userSelect ? userSelect.value : '';
        const viewMode = B.adminHistoryViewMode || 'detail';

        // 특정 클럽 단독 선택 시 100% 전폭 레이아웃 적용
        container.classList.toggle('single-club-view', Boolean(selectedClub));

        // 상단 모드 전환 버튼 상태 동기화
        const detailModeBtn = document.getElementById('admin-history-mode-detail-btn');
        const weekdayModeBtn = document.getElementById('admin-history-mode-weekday-btn');
        if (detailModeBtn && weekdayModeBtn) {
            detailModeBtn.classList.toggle('active', viewMode === 'detail');
            weekdayModeBtn.classList.toggle('active', viewMode === 'weekday');
        }

        // 관리자 클럽별 정산 이력 "조회 연도" — 상단 전역 연도(_selectedQueryYear) 기준 연동
        const adminYearSelect = document.getElementById('admin-history-year-select');
        const thisYear = new Date().getFullYear();
        const activeYear = B._selectedQueryYear;
        let selectedYear = (typeof activeYear !== 'undefined' && activeYear)
            ? activeYear
            : (adminYearSelect ? adminYearSelect.value : String(thisYear)) || String(thisYear);
        if (adminYearSelect) {
            adminYearSelect.value = selectedYear;
        }

        container.innerHTML = '';

        const filtered = historyList.filter(entry => {
            if (!selectedUser) return true;
            return entry.creatorName === selectedUser;
        });

        // 클럽별 그룹핑
        const entriesByClub = new Map();
        allKnownClubNames.sort((a, b) => a.localeCompare(b)).forEach(clubName => entriesByClub.set(clubName, []));
        filtered.forEach(entry => {
            const clubName = entry.clubName || t('label.default_club');
            if (!entriesByClub.has(clubName)) entriesByClub.set(clubName, []);
            entriesByClub.get(clubName).push(entry);
        });

        // 특정 클럽 필터 적용
        const displayClubNames = selectedClub
            ? [selectedClub].filter(c => entriesByClub.has(c))
            : Array.from(entriesByClub.keys());

        if (displayClubNames.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <span class="empty-icon">💨</span>
                    <p>${selectedClub ? `'${AppState.escapeHtml(selectedClub)}'의 ` : ''}등록된 정산 내역이 없습니다.</p>
                </div>
            `;
            return;
        }

        const seenByClub = getAdminHistorySeenByClub();
        let needsSeenSave = false;
        const isAllYears = selectedYear === 'ALL';
        const targetYearNum = parseInt(selectedYear, 10);
        const yearDisplayLabel = isAllYears ? '전체' : `${targetYearNum}년`;

        displayClubNames.forEach(clubName => {
            const clubEntries = entriesByClub.get(clubName) || [];
            const clubCard = document.createElement('section');
            clubCard.className = 'admin-inline-club-usage-card';

            const latestSavedAt = clubEntries.reduce((latest, entry) => Math.max(latest, getHistoryEntrySavedAt(entry)), 0);
            if (!Object.prototype.hasOwnProperty.call(seenByClub, clubName)) {
                seenByClub[clubName] = latestSavedAt;
                needsSeenSave = true;
            }
            const newEntryCount = clubEntries.filter(entry => getHistoryEntrySavedAt(entry) > Number(seenByClub[clubName] || 0)).length;
            const targetYearEntries = clubEntries.filter(entry => {
                if (isAllYears) return true;
                return getHistoryEntryYear(entry) === targetYearNum;
            });

            const header = document.createElement('div');
            header.className = 'admin-inline-club-usage-header';
            const heading = document.createElement('div');
            heading.className = 'admin-history-club-heading';
            const title = document.createElement('strong');
            title.textContent = `📁 ${clubName} 사용 요약`;
            const count = document.createElement('span');
            count.className = 'admin-history-club-count';
            count.textContent = `${yearDisplayLabel} 정산 ${targetYearEntries.length}건`;
            heading.append(title, count);
            if (newEntryCount > 0) {
                const newBadge = document.createElement('span');
                newBadge.className = 'admin-history-new-badge';
                newBadge.textContent = `신규 등록 ${newEntryCount}건`;
                heading.appendChild(newBadge);
            }

            header.appendChild(heading);

            const opts = {
                editableDates: true,
                excelDownloads: true,
                deleteEntries: true
            };
            const summaryEl = viewMode === 'weekday'
                ? createInlineClubWeekdaySummary(clubName, targetYearEntries, isAllYears ? '전체' : targetYearNum, opts)
                : createInlineClubUsageSummary(clubName, targetYearEntries, isAllYears ? '전체' : targetYearNum, opts);

            clubCard.append(header, summaryEl);
            container.appendChild(clubCard);
        });
        if (needsSeenSave) saveAdminHistorySeenByClub(seenByClub);
    }

    return {
        renderAdminDashboard,
        updateAdminStartGuide,
        syncAdminStartActionState,
        toggleAdminStartCard,
        deleteAdminHistoryEntry,
        getAdminTheme,
        getChartThemeColors,
        applyAdminTheme,
        renderClubFilters,
        getHistoryCategoryCost,
        getHistoryUsageBreakdown,
        formatHistoryUsageDate,
        closeClubUsageSummaryModal,
        openClubUsageSummaryModal,
        openAttendanceRosterModal,
        closeAttendanceRosterModal,
        updateGlobalYearPickerUI,
        renderYearPickerModalList,
        selectQueryYear,
        openYearPickerModal,
        closeYearPickerModal,
        renderAdminClubSelect,
        renderAdminUserSelect,
        renderAdminHistory
    };
};
