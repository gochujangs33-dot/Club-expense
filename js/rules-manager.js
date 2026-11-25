// ============================================================
// js/rules-manager.js — 연도별 정산 구간·비율·한도 설정 관리 모듈
// ============================================================
// v1.7.70: app.js 에서 분리 및 직전 연도 자동 승계 보완
//   - 연도별 독립 저장: globalSettings/yearlyRules/{연도} (올해일 때만 globalSettings/rules 동시 동기화)
//   - 신규 연도 자동 승계: 해당 연도 설정이 없으면 직전(가장 최신) 연도 설정을 이어받음
//   - 조회 연도 전환: selectQueryYear 시 해당 연도 설정으로 즉시 전환/표시

window.__installRulesState = function (targetAppState) {
    if (!targetAppState || typeof targetAppState !== 'object') return;

    Object.assign(targetAppState, {
        getRulesForYear(year, historyList = null) {
            const targetYearNum = Number(year) || new Date().getFullYear();
            const yKey = String(targetYearNum);

            // 1. 해당 연도에 명시적으로 저장된 설정이 있으면 최우선 반환
            const saved = this.yearlyRules && this.yearlyRules[yKey];
            if (saved && typeof saved === 'object') {
                return { ...DefaultRules, ...saved };
            }

            // 2. 이력 목록이 전달된 경우 해당 연도 이력의 rules 스냅샷 확인
            if (Array.isArray(historyList)) {
                const entryWithRules = historyList.find(e => e && String(getHistoryEntryYear(e)) === yKey && e.rules);
                if (entryWithRules) return { ...DefaultRules, ...entryWithRules.rules };
            }

            // 3. 해당 연도 설정이 아직 없으면 직전 연도 중 가장 최신 연도의 설정을 자동 승계
            if (this.yearlyRules && typeof this.yearlyRules === 'object') {
                const priorYears = Object.keys(this.yearlyRules)
                    .map(k => Number(k))
                    .filter(y => Number.isInteger(y) && y < targetYearNum && this.yearlyRules[String(y)] && typeof this.yearlyRules[String(y)] === 'object')
                    .sort((a, b) => b - a);
                if (priorYears.length > 0) {
                    return { ...DefaultRules, ...this.yearlyRules[String(priorYears[0])] };
                }
            }

            // 4. 서버 기준 기본 규칙(_baseRules) -> 현재 규칙 -> DefaultRules 순 폴백
            return { ...DefaultRules, ...(this._baseRules || this.rules || {}) };
        },

        saveGlobalRules(auditEvent = null, targetYear = null) {
            if (!this.firebaseDb) return Promise.resolve(false);
            const currentYear = new Date().getFullYear();
            const saveYear = Number(targetYear) || currentYear;
            const rulesSnapshot = targetYear && this.yearlyRules && this.yearlyRules[String(saveYear)]
                ? { ...this.yearlyRules[String(saveYear)] }
                : { ...this.rules };
            const updates = {
                [`globalSettings/yearlyRules/${saveYear}`]: rulesSnapshot
            };
            if (saveYear === currentYear) {
                updates['globalSettings/rules'] = rulesSnapshot;
                this._baseRules = { ...DefaultRules, ...rulesSnapshot };
            }
            if (auditEvent) this.appendAuditUpdate(updates, auditEvent);
            return this.firebaseDb.ref().update(updates)
                .then(() => true)
                .catch(err => {
                    console.error('globalSettings 저장 실패:', err);
                    return false;
                });
        },

        updateRules(newRules, targetYear = null) {
            const currentYear = new Date().getFullYear();
            const saveYear = Number(targetYear) || currentYear;
            const previousRules = this.getRulesForYear(saveYear);
            const mergedRules = { ...DefaultRules, ...newRules };
            this.yearlyRules = { ...(this.yearlyRules || {}), [String(saveYear)]: mergedRules };
            if (saveYear === currentYear) {
                this._baseRules = { ...mergedRules };
            }
            // 현재 활성 조회 연도와 일치하거나 올해 수정인 경우 즉시 AppState.rules에 반영
            const activeYear = typeof this.getActiveQueryYear === 'function' ? this.getActiveQueryYear() : currentYear;
            if (saveYear === activeYear || saveYear === currentYear) {
                this.rules = { ...mergedRules };
                this.save();
            }
            this.saveGlobalRules({
                action: 'UPDATE',
                targetType: '정산 구간 변경',
                targetLabel: `${saveYear}년 정산 기준`,
                summary: `${saveYear}년 정산 구간·비율·상품비·시설비 한도 변경`,
                details: {
                    적용연도: `${saveYear}년`,
                    이전가한도: previousRules.limit1,
                    변경가한도: mergedRules.limit1,
                    이전나한도: previousRules.limit2,
                    변경나한도: mergedRules.limit2,
                    이전나비율: previousRules.rate2,
                    변경나비율: mergedRules.rate2,
                    이전다한도: previousRules.limit3,
                    변경다한도: mergedRules.limit3,
                    이전다비율: previousRules.rate3,
                    변경다비율: mergedRules.rate3,
                    이전라공제액: previousRules.deduction4,
                    변경라공제액: mergedRules.deduction4,
                    이전상품비한도: previousRules.prizeLimit,
                    변경상품비한도: mergedRules.prizeLimit,
                    이전시설비한도: previousRules.facilityLimit,
                    변경시설비한도: mergedRules.facilityLimit
                }
            }, saveYear);
            this.render();
        },

        resetRules(targetYear = null) {
            const currentYear = new Date().getFullYear();
            const saveYear = Number(targetYear) || currentYear;
            const previousRules = this.getRulesForYear(saveYear);
            this.yearlyRules = { ...(this.yearlyRules || {}), [String(saveYear)]: { ...DefaultRules } };
            if (saveYear === currentYear) {
                this._baseRules = { ...DefaultRules };
            }
            const activeYear = typeof this.getActiveQueryYear === 'function' ? this.getActiveQueryYear() : currentYear;
            if (saveYear === activeYear || saveYear === currentYear) {
                this.rules = { ...DefaultRules };
                this.save();
            }
            this.saveGlobalRules({
                action: 'UPDATE',
                targetType: '정산 기준',
                targetLabel: `${saveYear}년 정산 기준`,
                summary: `${saveYear}년 정산 구간·비율·상품비·시설비 한도를 기본값으로 복원`,
                details: {
                    적용연도: `${saveYear}년`,
                    이전가한도: previousRules.limit1,
                    기본가한도: DefaultRules.limit1,
                    이전나한도: previousRules.limit2,
                    기본나한도: DefaultRules.limit2,
                    이전나비율: previousRules.rate2,
                    기본나비율: DefaultRules.rate2,
                    이전다한도: previousRules.limit3,
                    기본다한도: DefaultRules.limit3,
                    이전다비율: previousRules.rate3,
                    기본나비율_다: DefaultRules.rate3,
                    이전라공제액: previousRules.deduction4,
                    기본라공제액: DefaultRules.deduction4,
                    이전상품비한도: previousRules.prizeLimit,
                    기본상품비한도: DefaultRules.prizeLimit,
                    이전시설비한도: previousRules.facilityLimit,
                    기본시설비한도: DefaultRules.facilityLimit
                }
            }, saveYear);
            this.render();
        }
    });
};

window.__installRulesUI = function (B) {
    const adminRulesYearHint = document.getElementById('admin-rules-year-hint');

    const getSelectedAdminRulesYear = () => {
        const curY = new Date().getFullYear();
        const qy = typeof B.getSelectedQueryYear === 'function' ? B.getSelectedQueryYear() : window._selectedQueryYear;
        return (qy && qy !== 'ALL') ? (Number(qy) || curY) : curY;
    };

    const setAdminRulesFormValues = (rules) => {
        const r = { ...DefaultRules, ...(rules || {}) };
        const el1 = document.getElementById('admin-setting-limit1');
        const el2 = document.getElementById('admin-setting-limit2');
        const er2 = document.getElementById('admin-setting-rate2');
        const el3 = document.getElementById('admin-setting-limit3');
        const er3 = document.getElementById('admin-setting-rate3');
        const ed4 = document.getElementById('admin-setting-deduction4');
        if (el1) el1.value = formatAmount(r.limit1);
        if (el2) el2.value = formatAmount(r.limit2);
        if (er2) er2.value = Math.round((r.rate2 ?? 0.2) * 100);
        if (el3) el3.value = formatAmount(r.limit3);
        if (er3) er3.value = Math.round((r.rate3 ?? 0.4) * 100);
        if (ed4) ed4.value = formatAmount(r.deduction4);
        const prizeLimitEl = document.getElementById('admin-setting-prize-limit');
        if (prizeLimitEl) prizeLimitEl.value = formatAmount(r.prizeLimit || 500000);
        const facilityLimitEl = document.getElementById('admin-setting-facility-limit');
        if (facilityLimitEl) facilityLimitEl.value = formatAmount(r.facilityLimit || 85000);
        if (adminRulesYearHint) {
            const selY = getSelectedAdminRulesYear();
            const curY = new Date().getFullYear();
            adminRulesYearHint.textContent = selY === curY
                ? `📌 상단 조회 연도 [${selY}년] 적용 중 — 저장 시 ${selY}년 정산 계산 및 ${selY}년 결산 PPT에 반영됩니다.`
                : `📌 상단 조회 연도 [${selY}년] 전용 기준 — ${selY}년 정산 및 ${selY}년 결산 PPT에 별도 저장·적용됩니다.`;
        }
    };

    const syncActiveRulesForQueryYear = () => {
        const targetYear = getSelectedAdminRulesYear();
        const yearRules = AppState.getRulesForYear(targetYear);
        AppState.rules = { ...yearRules };
        setAdminRulesFormValues(yearRules);
    };

    syncActiveRulesForQueryYear();
    window._onYearlyRulesUpdate = syncActiveRulesForQueryYear;

    // Admin: 정산 비율 저장 (연도별 관리)
    const adminSaveRulesBtn = document.getElementById('admin-save-rules-btn');
    if (adminSaveRulesBtn) {
        adminSaveRulesBtn.addEventListener('click', () => {
            const targetYear = getSelectedAdminRulesYear();
            const limit1 = parseAmount(document.getElementById('admin-setting-limit1').value);
            const limit2 = parseAmount(document.getElementById('admin-setting-limit2').value);
            const rate2 = (parseInt(document.getElementById('admin-setting-rate2').value, 10) || 0) / 100;
            const limit3 = parseAmount(document.getElementById('admin-setting-limit3').value);
            const rate3 = (parseInt(document.getElementById('admin-setting-rate3').value, 10) || 0) / 100;
            const deduction4 = parseAmount(document.getElementById('admin-setting-deduction4').value);
            const prizeLimitEl = document.getElementById('admin-setting-prize-limit');
            const prizeLimit = prizeLimitEl ? (parseAmount(prizeLimitEl.value) || 500000) : 500000;
            const facilityLimitEl = document.getElementById('admin-setting-facility-limit');
            const facilityLimit = facilityLimitEl ? (parseAmount(facilityLimitEl.value) || 85000) : 85000;
            AppState.updateRules({ limit1, limit2, rate2, limit3, rate3, deduction4, prizeLimit, facilityLimit }, targetYear);
            alert(`${targetYear}년 정산 구간 및 한도 설정이 저장되었습니다.`);
        });
    }

    // Admin: 정산 비율 기본값 복원
    const adminResetRulesBtn = document.getElementById('admin-reset-rules-btn');
    if (adminResetRulesBtn) {
        adminResetRulesBtn.addEventListener('click', () => {
            const targetYear = getSelectedAdminRulesYear();
            showConfirmModal(
                `${targetYear}년 정산 구간 및 한도 설정을 기본값으로 복원하시겠습니까?`,
                () => {
                    AppState.resetRules(targetYear);
                    setAdminRulesFormValues(AppState.getRulesForYear(targetYear));
                },
                '복원',
                '기본값 복원 확인',
                '🔄'
            );
        });
    }

    return {
        getSelectedAdminRulesYear,
        setAdminRulesFormValues,
        syncActiveRulesForQueryYear
    };
};
