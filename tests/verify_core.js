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

const formatLocalDateYMD = vm.runInContext('formatLocalDateYMD', sandbox);
const stripHistoryMedia = vm.runInContext('stripHistoryMedia', sandbox);
const hasFacilityFullApprovalInEntry = vm.runInContext('hasFacilityFullApprovalInEntry', sandbox);
const hasOverLimitApprovalInEntry = vm.runInContext('hasOverLimitApprovalInEntry', sandbox);
const DefaultRules = vm.runInContext('DefaultRules', sandbox);
const SettlementCalculator = vm.runInContext('SettlementCalculator', sandbox);

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

console.log('verify_core.js: all checks passed');
