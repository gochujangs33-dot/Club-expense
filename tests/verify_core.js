'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function loadModule(relPath, sandbox) {
    const code = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
    vm.runInContext(code, sandbox, { filename: relPath });
}

function createSandbox() {
    const context = {
        console,
        Date,
        Math,
        Number,
        String,
        Array,
        Object,
        JSON,
        Set,
        Map,
        RegExp,
        Error,
        parseInt,
        parseFloat,
        isNaN,
        isFinite,
        setTimeout,
        clearTimeout,
        window: {},
        document: undefined,
        localStorage: {
            _data: {},
            getItem(k) { return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null; },
            setItem(k, v) { this._data[k] = String(v); },
            removeItem(k) { delete this._data[k]; }
        }
    };
    context.window = context;
    context.globalThis = context;
    return vm.createContext(context);
}

const sandbox = createSandbox();
loadModule('js/calc-locked.js', sandbox);
loadModule('js/settlement-history.js', sandbox);
loadModule('js/selfpay-splitter.js', sandbox);

const formatLocalDateYMD = vm.runInContext('formatLocalDateYMD', sandbox);
const stripHistoryMedia = vm.runInContext('stripHistoryMedia', sandbox);
const hasFacilityFullApprovalInEntry = vm.runInContext('hasFacilityFullApprovalInEntry', sandbox);
const hasOverLimitApprovalInEntry = vm.runInContext('hasOverLimitApprovalInEntry', sandbox);
const DefaultRules = vm.runInContext('DefaultRules', sandbox);
const SettlementCalculator = vm.runInContext('SettlementCalculator', sandbox);
const SelfPaySplitterEngine = vm.runInContext('SelfPaySplitterEngine', sandbox);

// 1. formatLocalDateYMD 테스트 (KST 00:00~08:59 구간에서도 UTC 전날로 밀리지 않음)
{
    const kstMorning = new Date('2026-11-26T00:30:00+09:00');
    const localFormatted = formatLocalDateYMD(kstMorning);
    const expectedLocal = [
        kstMorning.getFullYear(),
        String(kstMorning.getMonth() + 1).padStart(2, '0'),
        String(kstMorning.getDate()).padStart(2, '0')
    ].join('-');
    assert.strictEqual(localFormatted, expectedLocal, 'formatLocalDateYMD는 로컬 시간대 기준 YYYY-MM-DD를 반환해야 함');
    assert.match(formatLocalDateYMD(new Date()), /^\d{4}-\d{2}-\d{2}$/);
    assert.strictEqual(formatLocalDateYMD(new Date('invalid-date')), '');
}

// 2. stripHistoryMedia 테스트 (사진·영수증 Base64만 제거, 금액·항목 메타데이터는 보존)
{
    const sample = {
        id: 'hist-1',
        clubName: '테스트클럽',
        supportAmount: 150000,
        eventPhoto: 'data:image/jpeg;base64,/9j/4AAQ...',
        eventPhotos: ['data:image/jpeg;base64,/9j/1...', 'data:image/jpeg;base64,/9j/2...'],
        expenseItems: [
            {
                id: 'item-1',
                name: '식대',
                category: 'EVENT',
                amount: 150000,
                corporateAmount: 150000,
                personalAmount: 0,
                receiptImage: 'data:image/jpeg;base64,abc',
                corporateReceiptImage: 'data:image/jpeg;base64,def',
                personalReceiptImage: 'data:image/jpeg;base64,ghi'
            }
        ]
    };

    const stripped = stripHistoryMedia(sample);
    assert.strictEqual(stripped.eventPhoto, undefined);
    assert.strictEqual(stripped.eventPhotos, undefined);
    assert.strictEqual(stripped.expenseItems.length, 1);
    assert.strictEqual(stripped.expenseItems[0].receiptImage, undefined);
    assert.strictEqual(stripped.expenseItems[0].corporateReceiptImage, undefined);
    assert.strictEqual(stripped.expenseItems[0].personalReceiptImage, undefined);
    assert.strictEqual(stripped.expenseItems[0].amount, 150000);
    assert.strictEqual(stripped.expenseItems[0].corporateAmount, 150000);
    assert.strictEqual(stripped.supportAmount, 150000);
    assert.strictEqual(sample.eventPhotos.length, 2, '원본 객체는 변경하지 않아야 함');
}

// 3. CALCULATION_LOCKED 정산 계산 & 검증기 교차 테스트
{
    // 가/나/다/라 4구간 인당 자부담 확인
    assert.strictEqual(SettlementCalculator.calculateSelfPayPerPerson(30000, DefaultRules), 0);
    assert.strictEqual(SettlementCalculator.calculateSelfPayPerPerson(50000, DefaultRules), 10000);
    assert.strictEqual(SettlementCalculator.calculateSelfPayPerPerson(100000, DefaultRules), 28000);
    assert.strictEqual(SettlementCalculator.calculateSelfPayPerPerson(150000, DefaultRules), 65000);

    // 10명, 행사비 1,000,000원 -> 인당 100,000원 -> 인당 자부담 28,000원 -> 총 자부담 280,000원 / 지원금 720,000원
    const res = SettlementCalculator.calculate(
        10,
        [{ category: 'EVENT', amount: 1000000 }],
        0,
        DefaultRules
    );
    assert.strictEqual(res.perPersonSelfPay, 28000);
    assert.strictEqual(res.totalSelfPay, 280000);
    assert.strictEqual(res.finalSupportAmount, 720000);
    assert.strictEqual(res._validation.valid, true);
}

// 4. 수정 모드 시 기존 승인 상태 유지 판별 테스트
{
    assert.strictEqual(hasFacilityFullApprovalInEntry({ facilityFullApproved: true }), true);
    assert.strictEqual(hasOverLimitApprovalInEntry({ overLimitApproved: true }), true);
    // 구버전 이력(명시 플래그 없음)에서도 85,000원/인 초과 시설비 법인카드 배분 시 승인 이력으로 판별
    assert.strictEqual(hasFacilityFullApprovalInEntry({
        memberCount: 4,
        expenseItems: [{ category: 'FACILITY', amount: 600000, corporateAmount: 600000 }]
    }), true);
    assert.strictEqual(hasFacilityFullApprovalInEntry({
        memberCount: 4,
        expenseItems: [{ category: 'FACILITY', amount: 300000, corporateAmount: 300000 }]
    }), false);
    assert.strictEqual(hasOverLimitApprovalInEntry({
        memberCount: 2,
        expenseItems: [{ category: 'EVENT', amount: 250000, corporateAmount: 250000 }]
    }), true);
}

// 5. 자부담 계산 툴 (SelfPaySplitterEngine) 테스트: 기본 1/N · 면제 · 대신 내주기(2인분) · 금액 수동 수정 시 잔여금 자동 분배
{
    const basePeople = [
        { id: '1', name: '1번' },
        { id: '2', name: '2번' },
        { id: '3', name: '3번' },
        { id: '4', name: '4번' }
    ];

    // 5-1. 기본 1/N 분배 (100,000원 / 4명 = 각 25,000원)
    const r1 = SelfPaySplitterEngine.compute(100000, basePeople);
    assert.deepStrictEqual(r1.items.map(i => i.finalAmount), [25000, 25000, 25000, 25000]);

    // 5-2. 4번 면제 -> 1,2,3번이 100,000원 분배 (33,333 / 33,333 / 33,334)
    const r2 = SelfPaySplitterEngine.compute(100000, [
        { id: '1', name: '1번' },
        { id: '2', name: '2번' },
        { id: '3', name: '3번' },
        { id: '4', name: '4번', exempt: true }
    ]);
    assert.strictEqual(r2.items[3].finalAmount, 0);
    assert.strictEqual(r2.items.reduce((s, i) => s + i.finalAmount, 0), 100000);

    // 5-3. 2번을 드래그해서 1번에게 보냄 (paidBy: '1') -> 1번이 2인분(50,000원), 2번 0원, 3·4번 각 25,000원
    const r3 = SelfPaySplitterEngine.compute(100000, [
        { id: '1', name: '1번' },
        { id: '2', name: '2번', paidBy: '1' },
        { id: '3', name: '3번' },
        { id: '4', name: '4번' }
    ]);
    assert.strictEqual(r3.items[0].shareCount, 2);
    assert.strictEqual(r3.items[0].finalAmount, 50000);
    assert.strictEqual(r3.items[1].finalAmount, 0);
    assert.strictEqual(r3.items[2].finalAmount, 25000);
    assert.strictEqual(r3.items[3].finalAmount, 25000);

    // 5-4. 1번 금액을 40,000원으로 수동 수정 -> 남은 60,000원이 2·3·4번에게 각 20,000원씩 자동 분배
    const r4 = SelfPaySplitterEngine.compute(100000, [
        { id: '1', name: '1번', manualAmount: 40000 },
        { id: '2', name: '2번' },
        { id: '3', name: '3번' },
        { id: '4', name: '4번' }
    ]);
    assert.deepStrictEqual(r4.items.map(i => i.finalAmount), [40000, 20000, 20000, 20000]);

    // 5-5. 8명 86,000원 -> 1명 면제 -> 7명 합계 정확히 86,000원
    const eightPeople = Array.from({ length: 8 }, (_, idx) => ({ id: String(idx + 1), name: `${idx + 1}번`, exempt: idx === 0 }));
    const r5 = SelfPaySplitterEngine.compute(86000, eightPeople);
    assert.strictEqual(r5.items[0].finalAmount, 0);
    assert.strictEqual(r5.activeParticipantCount, 7);
    assert.strictEqual(r5.items.reduce((s, i) => s + i.finalAmount, 0), 86000);

    // 5-6. 1명 면제 + 1명 수동 금액(20,000) + 1명 대신 내주기 -> 전체 합계 정확히 86,000원
    const r6 = SelfPaySplitterEngine.compute(86000, [
        { id: '1', name: '1번', exempt: true },
        { id: '2', name: '2번', manualAmount: 20000 },
        { id: '3', name: '3번' },
        { id: '4', name: '4번', paidBy: '3' },
        { id: '5', name: '5번' }
    ]);
    assert.strictEqual(r6.items[0].finalAmount, 0);
    assert.strictEqual(r6.items[1].finalAmount, 20000);
    assert.strictEqual(r6.items[2].shareCount, 2);
    assert.strictEqual(r6.items[3].finalAmount, 0);
    assert.strictEqual(r6.items.reduce((s, i) => s + i.finalAmount, 0), 86000);
}

console.log('verify_core.js: all checks passed');
