// ═══════════════════════════════════════════════════════════════════════
// js/admin-clubs.js — 관리자 클럽 관리 모듈 (v1.7.49 부분 모듈화 4단계)
//  - renderClubManagement (⛔ AGENTS.md §1-6 재수정 금지 불변량 그대로 유지:
//    historyLoaded 가드 / DocumentFragment 조립 후 일괄 update / _isRenderingClubManagement 재진입 가드)
//  - 엑셀형 헤더 필터, 클럽 추가/수정/중복정리, 총 예산 저장
//  app.js DOMContentLoaded 안에서 window.__installAdminClubs(bridge) 호출 시점(원래 코드 위치)에 초기화된다.
//  B.historyLoaded / B.lastHistoryList 는 app.js 클로저 변수의 실시간 getter 이다.
// ═══════════════════════════════════════════════════════════════════════

window.__installAdminClubs = function (B) {
    const renderClubFilters = B.renderClubFilters;
    const updateAdminStartGuide = B.updateAdminStartGuide;
    let editingClubId = null;

    const clubTotalBudgetInput = document.getElementById('club-total-budget-input');
    const clubBudgetSummary = document.getElementById('club-budget-summary');
    const clubForm = document.getElementById('club-form');
    const clubNameFormInput = document.getElementById('club-name-form-input');
    const clubBudgetFormInput = document.getElementById('club-budget-form-input');
    const clubPriorUsedFormInput = document.getElementById('club-prior-used-form-input');
    const cancelEditClubBtn = document.getElementById('cancel-edit-club-btn');
    const clubListContainer = document.getElementById('club-list-container');

    let _isRenderingClubManagement = false;
    let _pendingClubManagementRender = false;
    let _clubMgmtSortKey = 'name'; // 'name' | 'budget' | 'prize' | 'remaining'
    let _clubMgmtSortDir = 'asc';  // 'asc' | 'desc'
    // 엑셀 스타일 컬럼별 체크박스 필터 상태 (null이면 해당 컬럼 '전체 선택', Set이면 선택된 값들만 표시)
    const _clubMgmtColFilters = {
        name: null,
        budget: null,
        prize: null,
        remaining: null
    };
    let _lastPreparedClubRows = [];
    let _activeClubFilterPopover = null;
    let _activeClubFilterCol = null;

    function getClubColValueKey(row, col) {
        if (col === 'name') return String(row.club.name || '');
        if (col === 'budget') return String(row.budget || 0);
        if (col === 'prize') return String(row.displayPrizeUsed || 0);
        if (col === 'remaining') return String(row.remaining || 0);
        return '';
    }

    function getClubColValueLabel(row, col) {
        if (col === 'name') return String(row.club.name || '');
        if (col === 'budget') return SettlementCalculator.formatCurrency(row.budget || 0);
        if (col === 'prize') return SettlementCalculator.formatCurrency(row.displayPrizeUsed || 0);
        if (col === 'remaining') return SettlementCalculator.formatCurrency(row.remaining || 0);
        return '';
    }

    function syncClubMgmtHeaderIndicators() {
        document.querySelectorAll('#club-list-header .club-th-filterable').forEach(th => {
            const col = th.getAttribute('data-filter-col');
            const iconEl = th.querySelector('.club-th-filter-btn');
            const isSorted = col === _clubMgmtSortKey;
            const filterSet = _clubMgmtColFilters[col];
            const isFiltered = filterSet instanceof Set;
            th.classList.toggle('is-active-sort', isSorted);
            th.classList.toggle('is-filtered', isFiltered);
            if (iconEl) {
                const sortArrow = isSorted ? (_clubMgmtSortDir === 'asc' ? '↑ ' : '↓ ') : '';
                const filterMark = isFiltered ? '⏳' : '▾';
                iconEl.textContent = `${sortArrow}${filterMark}`;
            }
        });
    }

    function closeClubExcelFilterPopover() {
        if (_activeClubFilterPopover && _activeClubFilterPopover.parentNode) {
            _activeClubFilterPopover.parentNode.removeChild(_activeClubFilterPopover);
        }
        _activeClubFilterPopover = null;
        _activeClubFilterCol = null;
    }

    function openClubExcelFilterPopover(col, anchorEl) {
        if (_activeClubFilterPopover && _activeClubFilterCol === col) {
            closeClubExcelFilterPopover();
            return;
        }
        closeClubExcelFilterPopover();
        _activeClubFilterCol = col;

        // 다른 컬럼의 필터가 적용된 상태를 기준으로 현재 컬럼에서 선택 가능한 고유 값 목록을 생성 (엑셀 방식)
        const baseRows = (_lastPreparedClubRows || []).filter(item => {
            for (const otherCol of ['name', 'budget', 'prize', 'remaining']) {
                if (otherCol === col) continue;
                const set = _clubMgmtColFilters[otherCol];
                if (set instanceof Set && !set.has(getClubColValueKey(item, otherCol))) {
                    return false;
                }
            }
            return true;
        });
        const sourceRows = baseRows.length > 0 ? baseRows : (_lastPreparedClubRows || []);

        const valueMap = new Map(); // key -> { key, label, numVal, count }
        sourceRows.forEach(row => {
            const key = getClubColValueKey(row, col);
            const label = getClubColValueLabel(row, col);
            const numVal = col === 'name' ? 0 : Number(key) || 0;
            if (!valueMap.has(key)) {
                valueMap.set(key, { key, label, numVal, count: 1 });
            } else {
                valueMap.get(key).count += 1;
            }
        });
        // 현재 필터에 이미 체크되어 있던 값도 누락되지 않도록 포함
        const existingSet = _clubMgmtColFilters[col];
        if (existingSet instanceof Set) {
            (_lastPreparedClubRows || []).forEach(row => {
                const key = getClubColValueKey(row, col);
                if (existingSet.has(key) && !valueMap.has(key)) {
                    valueMap.set(key, {
                        key,
                        label: getClubColValueLabel(row, col),
                        numVal: col === 'name' ? 0 : Number(key) || 0,
                        count: 0
                    });
                }
            });
        }

        const uniqueItems = Array.from(valueMap.values()).sort((a, b) => {
            if (col === 'name') return a.label.localeCompare(b.label, 'ko-KR');
            return b.numVal - a.numVal; // 금액 목록은 기본적으로 높은 금액부터 보기 좋게 나열
        });

        const colTitleMap = {
            name: '클럽명',
            budget: '배정예산',
            prize: '상품비',
            remaining: '잔여 예산'
        };
        const ascLabel = col === 'name' ? '↑ 가나다순 정렬 (오름차순)' : '↑ 낮은순 정렬 (오름차순)';
        const descLabel = col === 'name' ? '↓ 가나다 역순 정렬 (내림차순)' : '↓ 높은순 정렬 (내림차순)';

        const popover = document.createElement('div');
        popover.className = 'club-excel-filter-popover';
        popover.setAttribute('role', 'dialog');
        popover.setAttribute('aria-label', `${colTitleMap[col] || col} 정렬 및 필터`);

        const isAscActive = _clubMgmtSortKey === col && _clubMgmtSortDir === 'asc';
        const isDescActive = _clubMgmtSortKey === col && _clubMgmtSortDir === 'desc';

        popover.innerHTML = `
            <div class="club-excel-filter-section-title">${AppState.escapeHtml(colTitleMap[col] || '')} 정렬</div>
            <button type="button" class="club-excel-sort-btn ${isDescActive ? 'is-active' : ''}" data-sort-dir="desc">${descLabel}</button>
            <button type="button" class="club-excel-sort-btn ${isAscActive ? 'is-active' : ''}" data-sort-dir="asc">${ascLabel}</button>
            <div class="club-excel-divider"></div>
            <div class="club-excel-filter-section-title">목록 필터 (체크 선택)</div>
            <input type="text" class="club-excel-search-input" placeholder="${col === 'name' ? '클럽명 검색...' : '금액 검색...'}" autocomplete="off">
            <div class="club-excel-checklist"></div>
            <div class="club-excel-actions">
                <button type="button" class="btn-secondary club-excel-clear-btn">전체 해제/초기화</button>
                <button type="button" class="btn-primary-sm club-excel-apply-btn">확인</button>
            </div>
        `;

        const checklistEl = popover.querySelector('.club-excel-checklist');
        const searchInputEl = popover.querySelector('.club-excel-search-input');

        // 현재 선택 상태 복사본
        const selectedKeys = new Set(
            existingSet instanceof Set
                ? Array.from(existingSet)
                : uniqueItems.map(it => it.key)
        );

        function renderChecklist(keyword = '') {
            const kw = keyword.trim().toLowerCase();
            const visibleItems = kw
                ? uniqueItems.filter(it => it.label.toLowerCase().includes(kw) || it.key.toLowerCase().includes(kw))
                : uniqueItems;

            const frag = document.createDocumentFragment();

            const allRow = document.createElement('label');
            allRow.className = 'club-excel-check-item select-all-row';
            const allChecked = visibleItems.length > 0 && visibleItems.every(it => selectedKeys.has(it.key));
            const someChecked = visibleItems.some(it => selectedKeys.has(it.key));
            allRow.innerHTML = `
                <input type="checkbox" class="club-excel-check-all" ${allChecked ? 'checked' : ''}>
                <span class="club-excel-check-label">(전체 선택)</span>
                <span class="club-excel-check-count">${visibleItems.length}개</span>
            `;
            const allCheckbox = allRow.querySelector('.club-excel-check-all');
            if (allCheckbox && !allChecked && someChecked) {
                allCheckbox.indeterminate = true;
            }
            allCheckbox.addEventListener('change', () => {
                if (allCheckbox.checked) {
                    visibleItems.forEach(it => selectedKeys.add(it.key));
                } else {
                    visibleItems.forEach(it => selectedKeys.delete(it.key));
                }
                renderChecklist(searchInputEl.value);
            });
            frag.appendChild(allRow);

            visibleItems.forEach(it => {
                const itemLabel = document.createElement('label');
                itemLabel.className = 'club-excel-check-item';
                const checked = selectedKeys.has(it.key);
                itemLabel.innerHTML = `
                    <input type="checkbox" class="club-excel-check-val" data-val-key="${AppState.escapeHtml(it.key)}" ${checked ? 'checked' : ''}>
                    <span class="club-excel-check-label" title="${AppState.escapeHtml(it.label)}">${AppState.escapeHtml(it.label)}</span>
                    ${it.count > 1 ? `<span class="club-excel-check-count">(${it.count})</span>` : ''}
                `;
                const cb = itemLabel.querySelector('.club-excel-check-val');
                cb.addEventListener('change', () => {
                    if (cb.checked) selectedKeys.add(it.key);
                    else selectedKeys.delete(it.key);
                    const nowAll = visibleItems.length > 0 && visibleItems.every(v => selectedKeys.has(v.key));
                    const nowSome = visibleItems.some(v => selectedKeys.has(v.key));
                    allCheckbox.checked = nowAll;
                    allCheckbox.indeterminate = !nowAll && nowSome;
                });
                frag.appendChild(itemLabel);
            });

            checklistEl.replaceChildren(frag);
        }

        renderChecklist('');

        searchInputEl.addEventListener('input', () => {
            renderChecklist(searchInputEl.value);
        });

        popover.querySelectorAll('.club-excel-sort-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const dir = btn.getAttribute('data-sort-dir') === 'desc' ? 'desc' : 'asc';
                _clubMgmtSortKey = col;
                _clubMgmtSortDir = dir;
                closeClubExcelFilterPopover();
                renderClubManagement();
            });
        });

        popover.querySelector('.club-excel-clear-btn').addEventListener('click', () => {
            _clubMgmtColFilters[col] = null;
            closeClubExcelFilterPopover();
            renderClubManagement();
        });

        popover.querySelector('.club-excel-apply-btn').addEventListener('click', () => {
            if (selectedKeys.size === 0 || selectedKeys.size >= uniqueItems.length) {
                // 전체 선택이거나 아무것도 체크하지 않은 경우 필터 해제(전체 표시)
                _clubMgmtColFilters[col] = selectedKeys.size === 0 ? new Set() : null;
            } else {
                _clubMgmtColFilters[col] = new Set(selectedKeys);
            }
            closeClubExcelFilterPopover();
            renderClubManagement();
        });

        document.body.appendChild(popover);
        _activeClubFilterPopover = popover;

        // 위치 계산 (제목줄 셀 바로 아래, 화면 밖으로 넘치지 않게 보정)
        const rect = anchorEl.getBoundingClientRect();
        const popRect = popover.getBoundingClientRect();
        let left = rect.left;
        let top = rect.bottom + 4;
        if (left + popRect.width > window.innerWidth - 10) {
            left = Math.max(10, window.innerWidth - popRect.width - 10);
        }
        if (top + popRect.height > window.innerHeight - 10) {
            top = Math.max(10, rect.top - popRect.height - 4);
        }
        popover.style.left = `${Math.round(left)}px`;
        popover.style.top = `${Math.round(top)}px`;
    }

    document.querySelectorAll('#club-list-header .club-th-filterable').forEach(th => {
        th.addEventListener('click', (e) => {
            e.stopPropagation();
            const col = th.getAttribute('data-filter-col');
            if (!col) return;
            openClubExcelFilterPopover(col, th);
        });
        th.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                const col = th.getAttribute('data-filter-col');
                if (col) openClubExcelFilterPopover(col, th);
            }
        });
    });

    document.addEventListener('pointerdown', (e) => {
        if (!_activeClubFilterPopover) return;
        if (_activeClubFilterPopover.contains(e.target)) return;
        if (e.target.closest && e.target.closest('#club-list-header .club-th-filterable')) return;
        closeClubExcelFilterPopover();
    });

    function renderClubManagement() {
        // ⛔ 재진입 방지 가드 (v1.7.39):
        // Firebase 로컬 .on('value') 리스너는 .update() 호출 시 동기적(synchronously)으로 콜백을 즉시 실행한다.
        // 만약 렌더링 도중 재진입 호출이 발생하면 현재 루프가 끝난 뒤 1회만 깨끗하게 다시 그리도록 예약하고 즉시 반환한다.
        if (_isRenderingClubManagement) {
            _pendingClubManagementRender = true;
            return;
        }
        _isRenderingClubManagement = true;
        try {
            const totalBudgetEl = document.getElementById('club-total-budget-input');
            if (totalBudgetEl) {
                totalBudgetEl.value = formatAmount(AppState.clubTotalBudget || 0);
            }

            const _seenClubNames = new Set();
            const clubs = Object.entries(AppState.clubRegistry || {}).filter(([, c]) => {
                const key = (c.name || '').trim().toLowerCase();
                if (!key || _seenClubNames.has(key)) return false;
                _seenClubNames.add(key);
                return true;
            });
            updateAdminStartGuide();
            const totalClubsEl = document.getElementById('admin-total-clubs');
            if (totalClubsEl) totalClubsEl.textContent = `${clubs.length}개`;
            const allocated = clubs.reduce((sum, [, c]) => sum + (c.budget || 0), 0);
            const remaining = (AppState.clubTotalBudget || 0) - allocated;
            const budgetSummaryEl = document.getElementById('club-budget-summary');
            if (budgetSummaryEl) {
                budgetSummaryEl.textContent = `${SettlementCalculator.formatCurrency(allocated)} / ${SettlementCalculator.formatCurrency(remaining)}`;
                budgetSummaryEl.style.color = remaining < 0 ? 'var(--warning-text, #ff6b6b)' : 'var(--color-secondary)';
            }
            const adminTotalBudgetEl = document.getElementById('admin-total-budget');
            if (adminTotalBudgetEl) {
                adminTotalBudgetEl.textContent = SettlementCalculator.formatCurrency(allocated);
            }
            const realCurrentYear = new Date().getFullYear();
            const activeQueryYear = (typeof _selectedQueryYear !== 'undefined' && _selectedQueryYear)
                ? String(_selectedQueryYear)
                : String(realCurrentYear);
            const isAllQueryYears = activeQueryYear === 'ALL';
            const targetQueryYearNum = Number(activeQueryYear) || realCurrentYear;
            const filteredHistoryForSummary = (B.lastHistoryList || []).filter(e =>
                e && (isAllQueryYears || getHistoryEntryYear(e) === targetQueryYearNum)
            );
            const totalSupportVal = B.historyLoaded
                ? filteredHistoryForSummary.reduce((sum, e) => sum + (e && e.finalSupportAmount ? e.finalSupportAmount : 0), 0)
                : (targetQueryYearNum === realCurrentYear || isAllQueryYears
                    ? clubs.reduce((sum, [, c]) => sum + (c.usedBudget || 0), 0)
                    : 0);
            const adminSupportEl = document.getElementById('admin-total-support');
            if (adminSupportEl) {
                adminSupportEl.textContent = SettlementCalculator.formatCurrency(totalSupportVal);
            }
            const adminRemainingEl = document.getElementById('admin-remaining-budget');
            if (adminRemainingEl) {
                const remSupport = allocated - totalSupportVal;
                adminRemainingEl.textContent = SettlementCalculator.formatCurrency(remSupport);
                adminRemainingEl.style.color = remSupport < 0 ? 'var(--warning-text, #ff6b6b)' : '';
            }

            const listContainer = document.getElementById('club-list-container');
            const headerEl = document.getElementById('club-list-header');
            if (!listContainer) return;
            if (clubs.length === 0) {
                if (headerEl) headerEl.style.display = 'none';
                listContainer.innerHTML = `<div class="empty-state"><span class="empty-icon">🏷️</span><p>${t('empty.no_clubs')}</p></div>`;
                return;
            }
            if (headerEl) headerEl.style.display = 'grid';
            const clubColorMap = getClubColorMap();
            // ⛔ DOM 루프 내부에서 firebaseDb.ref().update()를 직접 호출하거나 listContainer.appendChild()를
            // 개별 호출하지 않는다 (v1.7.39):
            // 루프 도중 동기적 Firebase 리스너가 재진입해 바깥 루프의 나머지 행(2. 넷짱 ~ 11. Next mile)이
            // 중복으로 이어 붙는 버그를 원천 차단하기 위해 DocumentFragment 조립 후 replaceChildren으로
            // 원자적 교체하고, Firebase 동기화는 루프 완료 후 일괄 수행한다.
            const rowsFragment = document.createDocumentFragment();
            const pendingSyncUpdates = {};
            let hasPendingSync = false;

            const allClubsSortedByName = [...clubs].sort((a, b) => (a[1].name || '').localeCompare(b[1].name || '', 'ko-KR'));

            const _thisYear = new Date().getFullYear();
            const _thisYearKey = String(_thisYear);

            // 1단계: 모든 클럽의 표시 금액(배정예산/상품비/잔여예산) 계산 및 동기화 데이터 수집
            const preparedClubRows = allClubsSortedByName.map(([clubId, club]) => {
                // 상품비: globalHistory 기준으로 올해 실제 사용액 계산 후 Firebase에도 동기화
                const prizeUsed = B.lastHistoryList
                    .filter(entry => {
                        return historyMatchesClub(entry, clubId, club.name) && getHistoryEntryYear(entry) === _thisYear;
                    })
                    .reduce((sum, entry) => sum + getHistoryPrizeCost(entry), 0);
                // usedBudget: 올해 globalHistory 기준 확정 지원금 합산 (유저 예산 리미트 동기화)
                const usedBudget = B.lastHistoryList
                    .filter(entry => {
                        return historyMatchesClub(entry, clubId, club.name) && getHistoryEntryYear(entry) === _thisYear;
                    })
                    .reduce((sum, entry) => sum + (entry.finalSupportAmount || 0), 0);
                // Firebase 값과 다를 때만 업데이트 (prizeUsed + usedBudget 동시 처리)
                // historyLoaded 전에는 쓰기 금지 — 이력 로드 전 빈 리스트로 계산된 0원이
                // 공유 clubRegistry를 덮어써 다른 접속자에게 잔여예산이 잘못 표시되는 사고 방지
                const needsUpdate = (club.prizeUsed || 0) !== prizeUsed || (club.usedBudget || 0) !== usedBudget;
                if (needsUpdate && firebaseDb && B.historyLoaded) {
                    const previousPrizeUsed = club.prizeUsed || 0;
                    const previousUsedBudget = club.usedBudget || 0;
                    club.prizeUsed  = prizeUsed;
                    club.usedBudget = usedBudget;
                    if (AppState.baseClubRegistry && AppState.baseClubRegistry[clubId]) {
                        AppState.baseClubRegistry[clubId].prizeUsed = prizeUsed;
                        AppState.baseClubRegistry[clubId].usedBudget = usedBudget;
                    }
                    pendingSyncUpdates[`clubRegistry/${clubId}/prizeUsed`] = prizeUsed;
                    pendingSyncUpdates[`clubRegistry/${clubId}/usedBudget`] = usedBudget;
                    if (AppState.yearlyClubRegistry && AppState.yearlyClubRegistry[_thisYearKey] && AppState.yearlyClubRegistry[_thisYearKey][clubId]) {
                        AppState.yearlyClubRegistry[_thisYearKey][clubId].prizeUsed = prizeUsed;
                        AppState.yearlyClubRegistry[_thisYearKey][clubId].usedBudget = usedBudget;
                        pendingSyncUpdates[`yearlyClubRegistry/${_thisYearKey}/${clubId}/prizeUsed`] = prizeUsed;
                        pendingSyncUpdates[`yearlyClubRegistry/${_thisYearKey}/${clubId}/usedBudget`] = usedBudget;
                    }
                    hasPendingSync = true;
                    AppState.appendAuditUpdate(pendingSyncUpdates, {
                        action: 'UPDATE',
                        targetType: '클럽 누적액 자동 동기화',
                        targetId: clubId,
                        targetLabel: club.name,
                        summary: `시스템이 '${club.name}' 누적 지원금·상품비를 공유 이력 기준으로 동기화`,
                        clubId,
                        clubName: club.name,
                        details: {
                            이전지원금누적: previousUsedBudget,
                            변경지원금누적: usedBudget,
                            이전상품비누적: previousPrizeUsed,
                            변경상품비누적: prizeUsed
                        }
                    }, { pin: 'system', name: '시스템 자동 동기화', role: '시스템' });
                }
                const budget = club.budget || 0;
                const priorUsed = club.priorUsed || 0;
                // 화면 표시용 상품비·잔여예산은 상단 조회 연도(_selectedQueryYear) 기준 (2027년 등 미등록 연도는 0원부터 시작)
                const displayPrizeUsed = isAllQueryYears
                    ? B.lastHistoryList.filter(e => historyMatchesClub(e, clubId, club.name)).reduce((s, e) => s + getHistoryPrizeCost(e), 0)
                    : (targetQueryYearNum === _thisYear
                        ? prizeUsed
                        : B.lastHistoryList.filter(e => historyMatchesClub(e, clubId, club.name) && getHistoryEntryYear(e) === targetQueryYearNum).reduce((s, e) => s + getHistoryPrizeCost(e), 0));
                const displayUsedBudget = isAllQueryYears
                    ? B.lastHistoryList.filter(e => historyMatchesClub(e, clubId, club.name)).reduce((s, e) => s + (e.finalSupportAmount || 0), 0)
                    : (targetQueryYearNum === _thisYear
                        ? usedBudget
                        : B.lastHistoryList.filter(e => historyMatchesClub(e, clubId, club.name) && getHistoryEntryYear(e) === targetQueryYearNum).reduce((s, e) => s + (e.finalSupportAmount || 0), 0));
                const displayPriorUsed = (isAllQueryYears || targetQueryYearNum === _thisYear) ? priorUsed : 0;
                const remaining = budget - displayPriorUsed - displayUsedBudget;
                return {
                    clubId,
                    club,
                    budget,
                    displayPrizeUsed,
                    remaining
                };
            });

            _lastPreparedClubRows = preparedClubRows;
            syncClubMgmtHeaderIndicators();

            // 2단계: 엑셀 방식 컬럼별 체크박스 필터 및 오름차순·내림차순 정렬 적용
            const filteredClubRows = preparedClubRows.filter(item => {
                for (const col of ['name', 'budget', 'prize', 'remaining']) {
                    const set = _clubMgmtColFilters[col];
                    if (set instanceof Set && !set.has(getClubColValueKey(item, col))) {
                        return false;
                    }
                }
                return true;
            });

            const dirFactor = _clubMgmtSortDir === 'desc' ? -1 : 1;
            filteredClubRows.sort((a, b) => {
                let cmp = 0;
                if (_clubMgmtSortKey === 'budget') {
                    cmp = (a.budget || 0) - (b.budget || 0);
                } else if (_clubMgmtSortKey === 'prize') {
                    cmp = (a.displayPrizeUsed || 0) - (b.displayPrizeUsed || 0);
                } else if (_clubMgmtSortKey === 'remaining') {
                    cmp = (a.remaining || 0) - (b.remaining || 0);
                } else {
                    cmp = (a.club.name || '').localeCompare(b.club.name || '', 'ko-KR');
                }
                if (cmp !== 0) return cmp * dirFactor;
                return (a.club.name || '').localeCompare(b.club.name || '', 'ko-KR');
            });

            if (filteredClubRows.length === 0) {
                const emptyDiv = document.createElement('div');
                emptyDiv.className = 'empty-state';
                emptyDiv.style.padding = '1.25rem 0.5rem';
                emptyDiv.innerHTML = `
                    <span class="empty-icon">🔍</span>
                    <p>선택한 필터 조건에 일치하는 클럽이 없습니다.</p>
                    <button type="button" class="btn-secondary club-mgmt-empty-reset-btn" style="margin-top:0.5rem; padding:0.35rem 0.8rem; font-size:0.78rem;">필터 모두 해제</button>
                `;
                const resetAllBtn = emptyDiv.querySelector('.club-mgmt-empty-reset-btn');
                if (resetAllBtn) {
                    resetAllBtn.addEventListener('click', () => {
                        _clubMgmtColFilters.name = null;
                        _clubMgmtColFilters.budget = null;
                        _clubMgmtColFilters.prize = null;
                        _clubMgmtColFilters.remaining = null;
                        renderClubManagement();
                    });
                }
                rowsFragment.appendChild(emptyDiv);
            }

            filteredClubRows.forEach(({ clubId, club, budget, displayPrizeUsed, remaining }, idx) => {
                const overLimitApproved = !!club.allowOverLimitSupport;
                const facilityFullApproved = !!club.allowFacilityFullBudget;
                const chartColor = clubColorMap[club.name] || resolveClubBaseColor(clubId, club);
                const row = document.createElement('div');
                row.className = 'expense-row club-item-row';
                row.innerHTML = `
                    <div class="expense-row-left club-cell-name">
                        <label class="club-name-color-picker-label" data-tooltip="클럽명을 클릭하여 차트 색상을 변경합니다">
                            <span style="color:var(--text-muted); margin-right:0.2em; font-weight:400; font-size:0.9rem;">${idx + 1}.</span>
                            <span class="club-name-text" style="color:${chartColor}; font-weight:700; font-size:0.92rem; line-height:1.3; text-decoration:underline dotted rgba(255,255,255,0.25); text-underline-offset:3px;">${AppState.escapeHtml(club.name)}</span>
                            <span class="club-color-hint-icon" style="font-size:0.75rem; opacity:0.6; margin-left:3px;" title="차트 색상 변경">🎨</span>
                            <input type="color" class="club-chart-color-input" data-id="${AppState.escapeHtml(clubId)}" value="${chartColor}" aria-label="${AppState.escapeHtml(club.name)} 차트 색상">
                        </label>
                    </div>
                    <div class="club-amount-cell club-cell-budget">
                        ${SettlementCalculator.formatCurrency(budget)}
                    </div>
                    <div class="club-amount-cell club-cell-prize" style="color:${displayPrizeUsed > 0 ? 'hsl(35,90%,42%)' : 'var(--text-muted)'};">
                        ${SettlementCalculator.formatCurrency(displayPrizeUsed)}
                    </div>
                    <div class="club-amount-cell club-cell-remaining" style="color:${remaining < 0 ? 'var(--warning-text, #ff6b6b)' : 'var(--color-secondary)'};">
                        ${SettlementCalculator.formatCurrency(remaining)}
                    </div>
                    <div class="club-cell-btn club-cell-add">
                        <button class="btn-add-club-budget btn-secondary" data-id="${AppState.escapeHtml(clubId)}"
                            data-tooltip="이 클럽의 배정 예산에 금액을 더합니다 (기존 배정 예산 + 입력한 금액)"
                            style="width:100%; padding:0.3rem 0.4rem; font-size:0.78rem; white-space:nowrap;">${t('btn.add_budget')}</button>
                    </div>
                    <div class="club-cell-btn club-cell-overlimit">
                        <button class="btn-toggle-overlimit ${overLimitApproved ? 'is-approved' : ''}" data-id="${AppState.escapeHtml(clubId)}" data-current="${overLimitApproved ? '1' : '0'}"
                            data-tooltip="이사진 승인 시 이 클럽의 다음 정산 1건에 한해 인당 85,000원 초과 지원을 허용합니다 (클럽 잔여 예산은 여전히 초과 불가). 정산이 확정되면 사용 여부와 관계없이 자동으로 미승인 상태로 되돌아갑니다."
                            style="width:100%; padding:0.22rem 0.35rem; font-size:0.66rem; border-radius:5px; cursor:pointer; white-space:nowrap;">${overLimitApproved ? '🔓 85K 승인됨' : '🔒 85K 미승인'}</button>
                    </div>
                    <div class="club-cell-btn club-cell-facility-full">
                        <button class="btn-toggle-facility-full ${facilityFullApproved ? 'is-approved' : ''}" data-id="${AppState.escapeHtml(clubId)}" data-current="${facilityFullApproved ? '1' : '0'}"
                            data-tooltip="연간 시설·장비 이용료 등 특수 사유 시, 이 클럽의 다음 정산 1건에 한해 인당 85,000원 제한 없이 배정(잔여) 예산 전액까지 법인카드 결제를 허용하고 초과분은 개인카드로 분배합니다. 정산 확정 시 자동으로 미승인 상태로 되돌아갑니다."
                            style="width:100%; padding:0.22rem 0.35rem; font-size:0.66rem; border-radius:5px; cursor:pointer; white-space:nowrap;">${facilityFullApproved ? '🔓 시설 승인됨' : '🔒 시설 미승인'}</button>
                    </div>
                    <div class="expense-row-right club-cell-actions">
                        <button class="btn-edit-club btn-secondary" data-id="${AppState.escapeHtml(clubId)}" style="padding:0.3rem 0.5rem; font-size:0.78rem;">${t('btn.edit')}</button>
                        <button class="btn-delete-club btn-text-danger" data-id="${AppState.escapeHtml(clubId)}" style="padding:0.3rem 0.5rem; font-size:0.78rem;">${t('btn.delete')}</button>
                    </div>
                `;
                rowsFragment.appendChild(row);
            });

            listContainer.replaceChildren(rowsFragment);

            clubListContainer.querySelectorAll('.btn-edit-club').forEach(btn => {
                btn.addEventListener('click', () => {
                    const clubId = btn.getAttribute('data-id');
                    const club = AppState.clubRegistry[clubId];
                    if (!club) return;
                    editingClubId = clubId;
                    clubNameFormInput.value = club.name;
                    clubBudgetFormInput.value = formatAmount(club.budget || 0);
                    if (clubPriorUsedFormInput) clubPriorUsedFormInput.value = club.priorUsed ? formatAmount(club.priorUsed) : '';
                    document.getElementById('add-club-btn').innerHTML = t('btn.edit_done');
                    cancelEditClubBtn.classList.remove('hidden');
                    clubNameFormInput.focus();
                });
            });
            clubListContainer.querySelectorAll('.btn-toggle-overlimit').forEach(btn => {
                btn.addEventListener('click', () => {
                    const clubId = btn.getAttribute('data-id');
                    const club = AppState.clubRegistry[clubId];
                    if (!club) return;
                    const willAllow = btn.getAttribute('data-current') !== '1';
                    const msg = willAllow
                        ? `'${club.name}' 클럽의 다음 정산 1건에 한해 인당 85,000원 초과 지원을 승인하시겠습니까?\n(클럽 잔여 예산 자체는 여전히 초과할 수 없으며, 정산이 확정되면 자동으로 미승인 상태로 돌아갑니다)`
                        : `'${club.name}' 클럽의 인당 85,000원 초과 지원 승인을 취소하시겠습니까?`;
                    showConfirmModal(msg, () => {
                        AppState.setClubOverLimitApproval(clubId, willAllow);
                        renderClubManagement();
                    }, willAllow ? '승인' : '승인 취소');
                });
            });
            clubListContainer.querySelectorAll('.btn-toggle-facility-full').forEach(btn => {
                btn.addEventListener('click', () => {
                    const clubId = btn.getAttribute('data-id');
                    const club = AppState.clubRegistry[clubId];
                    if (!club) return;
                    const willAllow = btn.getAttribute('data-current') !== '1';
                    const msg = willAllow
                        ? `'${club.name}' 클럽의 다음 정산 1건에 한해 시설·장비 이용료를 인당 한도 제한 없이 배정(잔여) 예산 전액까지 법인카드 사용으로 승인하시겠습니까?\n(잔여 예산 초과 금액은 자동으로 개인카드 자부담 처리되며, 정산 확정 시 자동으로 미승인 상태로 돌아갑니다)`
                        : `'${club.name}' 클럽의 시설·장비 이용료 전액 사용 승인을 취소하시겠습니까?`;
                    showConfirmModal(msg, () => {
                        AppState.setClubFacilityFullBudgetApproval(clubId, willAllow);
                        renderClubManagement();
                    }, willAllow ? '승인' : '승인 취소');
                });
            });
            clubListContainer.querySelectorAll('.club-name-color-picker-label').forEach(label => {
                label.addEventListener('click', (e) => {
                    const input = label.querySelector('.club-chart-color-input');
                    if (!input) return;
                    if (e.target === input) return;
                    try {
                        if (typeof input.showPicker === 'function') {
                            input.showPicker();
                        } else {
                            input.click();
                        }
                    } catch (err) {
                        input.click();
                    }
                });
            });
            clubListContainer.querySelectorAll('.club-chart-color-input').forEach(input => {
                input.addEventListener('change', () => {
                    const clubId = input.getAttribute('data-id');
                    input.disabled = true;
                    Promise.resolve(AppState.setClubChartColor(clubId, input.value)).then(() => {
                        renderClubManagement();
                        renderClubFilters();
                        renderAllCharts(B.lastHistoryList);
                    }).catch(() => {
                        alert('클럽 차트 색상을 저장하지 못했습니다. 네트워크 상태를 확인해 주세요.');
                        renderClubManagement();
                    }).finally(() => { input.disabled = false; });
                });
            });
            clubListContainer.querySelectorAll('.btn-add-club-budget').forEach(btn => {
                btn.addEventListener('click', () => {
                    const clubId = btn.getAttribute('data-id');
                    const club = AppState.clubRegistry[clubId];
                    if (!club) return;
                    openAddClubBudgetModal(club.name, (addAmount) => {
                        if (addAmount <= 0) return;
                        AppState.addClubBudgetAllocation(clubId, addAmount);
                        renderClubManagement();
                    });
                });
            });
            clubListContainer.querySelectorAll('.btn-delete-club').forEach(btn => {
                btn.addEventListener('click', () => {
                    const clubId = btn.getAttribute('data-id');
                    const club = AppState.clubRegistry[clubId];
                    if (!club) return;
                    showConfirmModal(`'${club.name}' 클럽을 삭제하시겠습니까?`, () => {
                        AppState.deleteClub(clubId);
                        renderClubManagement();
                    });
                });
            });

            if (hasPendingSync && firebaseDb && B.historyLoaded) {
                firebaseDb.ref().update(pendingSyncUpdates).catch(() => {});
            }
        } finally {
            _isRenderingClubManagement = false;
            if (_pendingClubManagementRender) {
                _pendingClubManagementRender = false;
                renderClubManagement();
            }
        }
    }
    window._onClubTotalBudgetUpdate = renderClubManagement;

    function resetClubForm() {
        editingClubId = null;
        clubNameFormInput.value = '';
        clubBudgetFormInput.value = '';
        if (clubPriorUsedFormInput) clubPriorUsedFormInput.value = '';
        document.getElementById('add-club-btn').innerHTML = t('btn.add_club_active');
        cancelEditClubBtn.classList.add('hidden');
    }

    // 중복 클럽 정리 버튼
    const dedupClubsBtn = document.getElementById('dedup-clubs-btn');
    if (dedupClubsBtn) {
        dedupClubsBtn.addEventListener('click', () => {
            const registry = AppState.clubRegistry || {};
            // 이름 기준으로 그룹핑 (대소문자 무관)
            const groups = {};
            for (const [id, club] of Object.entries(registry)) {
                const key = club.name.trim().toLowerCase();
                if (!groups[key]) groups[key] = [];
                groups[key].push({ id, club });
            }
            // 중복이 있는 그룹만 추출
            const dupGroups = Object.values(groups).filter(g => g.length > 1);
            if (dupGroups.length === 0) {
                showConfirmModal('중복된 클럽이 없습니다.', null, '확인', '알림', 'ℹ️');
                return;
            }
            const totalDups = dupGroups.reduce((s, g) => s + g.length - 1, 0);
            const names = dupGroups.map(g => `'${g[0].club.name}' (${g.length}개)`).join(', ');
            showConfirmModal(
                `중복 클럽 ${totalDups}개를 삭제합니다.\n${names}\n각 이름별로 예산이 가장 큰 항목 하나만 남깁니다.\n계속하시겠습니까?`,
                () => {
                    for (const group of dupGroups) {
                        // 예산이 가장 큰 항목을 keep (같으면 첫 번째)
                        group.sort((a, b) => (b.club.budget || 0) - (a.club.budget || 0));
                        const [keep, ...remove] = group;
                        // 남길 항목: priorUsed는 가장 큰 값 사용 (합산하면 과다)
                        const maxPriorUsed = Math.max(...group.map(g => g.club.priorUsed || 0));
                        if (maxPriorUsed !== (keep.club.priorUsed || 0)) {
                            AppState.addOrUpdateClub(keep.id, keep.club.name, keep.club.budget || 0, maxPriorUsed, keep.club.prizeUsed || 0);
                        }
                        // 나머지 삭제
                        for (const { id } of remove) {
                            AppState.deleteClub(id);
                        }
                    }
                    renderClubManagement();
                    alert(`중복 클럽 ${totalDups}개 삭제 완료`);
                }
            );
        });
    }

    if (clubTotalBudgetInput) {
        clubTotalBudgetInput.addEventListener('change', () => {
            AppState.saveClubTotalBudget(parseAmount(clubTotalBudgetInput.value));
            renderClubManagement();
        });
    }

    const saveClubTotalBudgetBtn = document.getElementById('save-club-total-budget-btn');
    if (saveClubTotalBudgetBtn) {
        saveClubTotalBudgetBtn.addEventListener('click', () => {
            const value = parseAmount(clubTotalBudgetInput.value);
            Promise.resolve(AppState.saveClubTotalBudget(value)).then(() => {
                renderClubManagement();
                const statusEl = document.getElementById('club-total-budget-status');
                if (statusEl) {
                    statusEl.style.display = 'block';
                    setTimeout(() => { statusEl.style.display = 'none'; }, 2000);
                }
                renderAllCharts(B.lastHistoryList);
            }).catch(() => {
                alert(t('alert.total_budget_save_failed'));
            });
        });
    }

    if (clubForm) {
        clubForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const name = clubNameFormInput.value.trim();
            const budget = parseAmount(clubBudgetFormInput.value);
            const priorUsed = (editingClubId && AppState.clubRegistry[editingClubId]) ? (AppState.clubRegistry[editingClubId].priorUsed || 0) : 0;
            if (!name) return;

            // 이름 중복 체크 (신규: 전체 / 수정: 자신 제외)
            const nameLower = name.toLowerCase();
            const duplicate = Object.entries(AppState.clubRegistry || {}).find(
                ([id, c]) => id !== editingClubId && c.name.trim().toLowerCase() === nameLower
            );
            if (duplicate) {
                showConfirmModal(`'${name}' 이름의 클럽이 이미 존재합니다.\n동일한 이름의 클럽은 추가할 수 없습니다.`, null, '확인', '알림', '⚠️');
                return;
            }

            const clubId = editingClubId || ('club_' + Date.now());

            // 이름이 실제로 변경된 경우에만 이력 소급 갱신
            const oldName = (editingClubId && AppState.clubRegistry[editingClubId]) ? AppState.clubRegistry[editingClubId].name : null;
            AppState.addOrUpdateClub(clubId, name, budget, priorUsed);
            if (oldName && oldName !== name) {
                AppState.renameClubInHistory(clubId, oldName, name);
            }

            resetClubForm();
            renderClubManagement();
        });
    }

    if (cancelEditClubBtn) {
        cancelEditClubBtn.addEventListener('click', resetClubForm);
    }

    // app.js 클로저 외부 참조용 전역 노출
    window.renderClubManagement = renderClubManagement;
    window.resetClubForm = resetClubForm;
};
