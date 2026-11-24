/**
 * 정산 계산식 및 교차 검증 잠금 모듈 (v1.7.48 분리)
 * ⛔ CALCULATION_LOCKED 블록은 사용자(관리자)의 명시적 서면 요청 없이 1행도 수정·삭제·재작성 금지.
 */

// --- 1. Expense Category Definitions & Rules ---
const ExpenseCategory = {
    EVENT: 'EVENT',
    FACILITY: 'FACILITY',
    PRIZE: 'PRIZE'
};

// Map category key to Korean display name
const categoryNameMap = {
    [ExpenseCategory.EVENT]: '행사비',
    [ExpenseCategory.FACILITY]: '시설 및 장비 이용료',
    [ExpenseCategory.PRIZE]: '상품'
};

// Default calculation thresholds and rates
const DefaultRules = {
    limit1: 30000,       // 가. 지원 한도 (3만 원 이하 자부담 0%)
    limit2: 60000,       // 나. 구간 한도 (6만 원 이하)
    rate2: 0.2,          // 나. 자부담 비율 (20%)
    limit3: 120000,      // 다. 구간 한도 (12만 원 이하)
    rate3: 0.4,          // 다. 자부담 비율 (40%)
    deduction4: 85000,      // 라. 초과 시 자부담 공제액 (8만 5천 원)
    prizeLimit: 500000,     // 상품비 연간 최대 사용 금액
    facilityLimit: 85000    // 시설·장비 이사진 승인 시 법인카드 최대 한도
};

// ⛔ CALCULATION_LOCKED ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 아래 SettlementCalculator / SettlementValidator 블록은
// 관리자(사용자)의 명시적 서면 요청 없이는 절대 수정 금지.
// 수정이 필요하면 CALCULATION_SPEC.md를 먼저 갱신하고 검증 예시값과 대조 후 진행.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// --- 2-A. 독립 검증기 (SettlementCalculator와 별도 로직으로 교차 검증) ---
// calculate() 완료 직후 자동 호출되어 결과값의 수학적 정합성을 재확인한다.
const SettlementValidator = Object.freeze({
    // 허용 오차: 반올림 차이 최대 ±1원
    TOLERANCE: 1,

    // 인당 자부담 독립 계산 (SettlementCalculator.calculateSelfPayPerPerson 와 동일 공식)
    _selfPay(cost, rules) {
        if (cost <= rules.limit1) return 0;
        if (cost <= rules.limit2) return cost * rules.rate2;
        if (cost <= rules.limit3) return rules.limit2 * rules.rate2 + (cost - rules.limit2) * rules.rate3;
        return cost - rules.deduction4;
    },

    validate(memberCount, expenseItems, rules, result) {
        const errs = [];
        const r = result;
        const T = this.TOLERANCE;

        // ① 카테고리별 비용 합계
        const expTotal    = expenseItems.reduce((s, i) => s + i.amount, 0);
        const expEvent    = expenseItems.filter(i => i.category === 'EVENT').reduce((s, i) => s + i.amount, 0);
        const expFacility = expenseItems.filter(i => i.category === 'FACILITY').reduce((s, i) => s + i.amount, 0);
        const expPrize    = expenseItems.filter(i => i.category === 'PRIZE').reduce((s, i) => s + i.amount, 0);

        if (Math.abs(r.totalCost    - expTotal)    > T) errs.push(`totalCost: 기대 ${expTotal}, 실제 ${r.totalCost}`);
        if (Math.abs(r.eventCost    - expEvent)    > T) errs.push(`eventCost: 기대 ${expEvent}, 실제 ${r.eventCost}`);
        if (Math.abs(r.facilityCost - expFacility) > T) errs.push(`facilityCost: 기대 ${expFacility}, 실제 ${r.facilityCost}`);
        if (Math.abs(r.prizeCost    - expPrize)    > T) errs.push(`prizeCost: 기대 ${expPrize}, 실제 ${r.prizeCost}`);

        // ② 인당 행사비
        const expPPE = memberCount > 0 ? expEvent / memberCount : 0;
        if (Math.abs(r.perPersonEventCost - expPPE) > T) errs.push(`perPersonEventCost: 기대 ${expPPE}, 실제 ${r.perPersonEventCost}`);

        // ③ 인당 자부담 (4단계 구간)
        const expSP = this._selfPay(expPPE, rules);
        if (Math.abs(r.perPersonSelfPay - expSP) > T) errs.push(`perPersonSelfPay: 기대 ${expSP}, 실제 ${r.perPersonSelfPay}`);

        // ④ 총 자부담 (반올림)
        const expTSP = Math.round(expSP * memberCount);
        if (Math.abs(r.totalSelfPay - expTSP) > T) errs.push(`totalSelfPay: 기대 ${expTSP}, 실제 ${r.totalSelfPay}`);

        // ⑤ 최종 지원금
        const expSupport = expTotal - expTSP;
        if (Math.abs(r.finalSupportAmount - expSupport) > T) errs.push(`finalSupportAmount: 기대 ${expSupport}, 실제 ${r.finalSupportAmount}`);

        // ⑥ 자부담 비율
        const expRatio = expTotal > 0 ? expTSP / expTotal : 0;
        if (Math.abs(r.selfPayRatio - expRatio) > 0.0001) errs.push(`selfPayRatio: 기대 ${expRatio.toFixed(4)}, 실제 ${r.selfPayRatio.toFixed(4)}`);

        if (errs.length > 0) {
            console.error('🚨 [정산 계산 검증 실패] — 즉시 확인 필요!\n' + errs.join('\n'));
        }
        return { valid: errs.length === 0, errors: errs };
    }
});

// --- 2-B. Settlement Calculator Logic ---
const SettlementCalculator = Object.freeze({
    calculate(memberCount, expenseItems, previousPrizeTotal = 0, rules = DefaultRules) {
        const totalCost = expenseItems.reduce((sum, item) => sum + item.amount, 0);
        const eventCost = expenseItems
            .filter(item => item.category === ExpenseCategory.EVENT)
            .reduce((sum, item) => sum + item.amount, 0);
        const facilityCost = expenseItems
            .filter(item => item.category === ExpenseCategory.FACILITY)
            .reduce((sum, item) => sum + item.amount, 0);
        const prizeCost = expenseItems
            .filter(item => item.category === ExpenseCategory.PRIZE)
            .reduce((sum, item) => sum + item.amount, 0);

        const perPersonEventCost = memberCount > 0 ? eventCost / memberCount : 0.0;

        const selfPayPerPerson = this.calculateSelfPayPerPerson(perPersonEventCost, rules);
        const totalSelfPay = Math.round(selfPayPerPerson * memberCount);
        const selfPayRatio = totalCost > 0 ? totalSelfPay / totalCost : 0.0;
        const finalSupportAmount = totalCost - totalSelfPay;

        // 항목별 개인/법인카드 배분 합계 (v1.6.215+) — "정책상 최소"인 위 totalSelfPay/finalSupportAmount와
        // 별개의 "실제" 값. 카테고리 무관하게 전 항목의 personalAmount를 합산한다.
        const itemSelfPay = expenseItems.reduce((sum, item) => sum + (item.personalAmount || 0), 0);
        const itemSupportAmount = totalCost - itemSelfPay;

        const warnings = [];

        if (prizeCost + previousPrizeTotal > (rules.prizeLimit || 500000)) {
            warnings.push("상품비 연 한도 50만원을 초과할 수 없습니다.");
        }

        const result = {
            memberCount,
            totalCost,
            eventCost,
            facilityCost,
            prizeCost,
            perPersonEventCost,
            perPersonSelfPay: selfPayPerPerson,
            totalSelfPay,
            selfPayRatio,
            finalSupportAmount,
            itemSelfPay,
            itemSupportAmount,
            warnings
        };

        // ━━ 자동 교차 검증 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        const validation = SettlementValidator.validate(memberCount, expenseItems, rules, result);
        result._validation = validation; // 호출자가 필요시 참조 가능
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

        return result;
    },

    calculateSelfPayPerPerson(cost, rules = DefaultRules) {
        if (cost <= rules.limit1) {
            return 0.0;
        } else if (cost <= rules.limit2) {
            return cost * rules.rate2;
        } else if (cost <= rules.limit3) {
            const part1 = rules.limit2 * rules.rate2; // 60,000원 * 20% = 12,000원
            const part2 = (cost - rules.limit2) * rules.rate3; // 초과액 * 40%
            return part1 + part2;
        } else {
            return cost - rules.deduction4;
        }
    },

    formatCurrency(value) {
        return new Intl.NumberFormat('ko-KR').format(Math.round(value)) + '원';
    }
});
// ⛔ CALCULATION_LOCKED END ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
