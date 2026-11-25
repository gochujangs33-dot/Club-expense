// ============================================================
// js/ui-modals.js — 공통 모달 · 규정 안내 · 전역 툴팁 · 이미지 압축 유틸리티
// ============================================================
// v1.7.68: app.js 에서 분리
//   - showCorpOverLimitModal / showFacilityApprovalModal / openRulesGuideModal
//   - initGlobalTooltip ([data-tooltip] 이벤트 위임)
//   - showEditModal / showConfirmModal / showAlertModal (window.alert 오버라이드) / showPrizeModal
//   - formatMediaSize / compressImageForStorage / compressReceiptImage

// 인당 법인카드 지원액이 정책 계산값을 초과할 때 이사진 승인 확인 모달 (주의 단계)
function showCorpOverLimitModal(messageHtml, onApproved, onNoApproval) {
    const modal = document.getElementById('corp-overlimit-approval-modal');
    if (!modal) { onNoApproval(); return; }
    const msgEl = document.getElementById('corp-overlimit-modal-msg');
    const yesBtn = document.getElementById('corp-overlimit-yes-btn');
    const noBtn = document.getElementById('corp-overlimit-no-btn');
    if (msgEl) msgEl.innerHTML = messageHtml;

    modal.style.display = 'flex';
    const close = () => { modal.style.display = 'none'; };
    const onYesClick = () => { close(); yesBtn.removeEventListener('click', onYesClick); noBtn.removeEventListener('click', onNoClick); onApproved(); };
    const onNoClick = () => { close(); yesBtn.removeEventListener('click', onYesClick); noBtn.removeEventListener('click', onNoClick); onNoApproval(); };
    yesBtn.addEventListener('click', onYesClick);
    noBtn.addEventListener('click', onNoClick);
}

// 시설·장비 선택 시 임원진 승인 여부를 상기시키는 안내 팝업 — 확인 버튼 하나만 있고 계산에는
// 영향을 주지 않는다(단순 안내). 실제 법인카드 한도는 _calcCorpForItem에서 항상 인당
// rules.facilityLimit × 인원수 기준으로 계산된다. (v1.6.232)
function showFacilityApprovalModal() {
    const modal = document.getElementById('facility-approval-modal');
    if (!modal) return;
    // 관리자 설정 facilityLimit 값을 동적으로 반영
    const limit = (AppState.rules || DefaultRules).facilityLimit || 85000;
    const limitEl = modal.querySelector('#facility-modal-limit');
    if (limitEl) limitEl.textContent = limit.toLocaleString() + '원';
    modal.style.display = 'flex';
    const okBtn = document.getElementById('facility-approved-btn');
    const close = () => { modal.style.display = 'none'; };
    const onOkClick = () => { close(); okBtn.removeEventListener('click', onOkClick); };
    okBtn.addEventListener('click', onOkClick);
}

// ── 정산 구간 및 자부담 기준 안내 모달 ──────────────────────────────
function renderRulesGuideModalContent() {
    const content = document.getElementById('rules-guide-modal-content');
    if (!content) return;

    const rules = AppState.rules || DefaultRules;
    const l1 = rules.limit1 || 30000;
    const l2 = rules.limit2 || 60000;
    const r2Ratio = rules.rate2 !== undefined ? rules.rate2 : 0.2;
    const r2Pct = Math.round(r2Ratio * 100);
    const l3 = rules.limit3 || 120000;
    const r3Ratio = rules.rate3 !== undefined ? rules.rate3 : 0.4;
    const r3Pct = Math.round(r3Ratio * 100);
    const ded4 = rules.deduction4 || 85000;
    const facilityLimit = rules.facilityLimit || 85000;
    const prizeLimit = rules.prizeLimit || 500000;

    // 구간별 경계 및 핵심 예시 금액
    const part1 = Math.round(l2 * r2Ratio); // 60,000 * 20% = 12,000
    const selfAtL3 = part1 + Math.round((l3 - l2) * r3Ratio); // 120,000원 시 자부담 36,000
    const corpAtL3 = l3 - selfAtL3; // 120,000원 시 회사 지원 84,000

    content.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:0.75rem;">
            <!-- 상단 안내 바 -->
            <div class="rules-guide-tip-banner">
                💡 <strong>구간 기준:</strong> 식대·활동비 등 <strong>순수 행사비</strong>를 참석 인원수로 나눈 <strong>1인당 금액</strong>을 기준으로 자부담이 결정됩니다. (시설비·상품비는 별도 규정 적용)
            </div>

            <!-- 가 구간 -->
            <div class="rules-bracket-card bracket-card-a">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.35rem; flex-wrap:wrap; gap:0.3rem;">
                    <span class="rules-bracket-title">가. 전액 지원 (1인당 ${formatAmount(l1)}원 이하)</span>
                    <span class="rules-bracket-badge">자부담 0% · 회사 100% 지원</span>
                </div>
                <div class="rules-bracket-desc">
                    인당 행사비가 <strong>${formatAmount(l1)}원</strong> 이하인 경우, 개인 부담금 없이 회사가 <strong>전액(100%) 지원</strong>합니다.
                </div>
                <div class="rules-bracket-example">
                    📌 <strong>예시:</strong> 4명이 식대 총 ${formatAmount(l1 * 4)}원 지출 ➔ 인당 ${formatAmount(l1)}원 ➔ <strong>자부담 0원</strong> (회사 지원 ${formatAmount(l1 * 4)}원)
                </div>
            </div>

            <!-- 나 구간 -->
            <div class="rules-bracket-card bracket-card-b">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.35rem; flex-wrap:wrap; gap:0.3rem;">
                    <span class="rules-bracket-title">나. 일반 지원 (${formatAmount(l1 + 1)}원 ~ ${formatAmount(l2)}원 이하)</span>
                    <span class="rules-bracket-badge">자부담 ${r2Pct}% · 회사 지원 ${100 - r2Pct}%</span>
                </div>
                <div class="rules-bracket-desc">
                    인당 행사비가 ${formatAmount(l1)}원을 초과하면 <strong>전체 금액의 ${r2Pct}%</strong>를 개인이 부담하고, <strong>${100 - r2Pct}%</strong>는 회사가 지원합니다.
                </div>
                <div class="rules-bracket-warning">
                    ⚠️ <strong>참고 (전체 비율 적용):</strong> 초과분만이 아니라 <strong>전체 금액에 ${r2Pct}%</strong>가 적용되므로, ${formatAmount(l1 + 1)}원 지출 시 즉시 ${formatAmount(Math.round((l1 + 1) * r2Ratio))}원의 자부담이 발생합니다.
                </div>
                <div class="rules-bracket-example">
                    📌 <strong>예시:</strong> 1인당 <strong>${formatAmount(l1 + 1)}원</strong> 지출 시 ➔ <strong>자부담 ${formatAmount(Math.round((l1 + 1) * r2Ratio))}원</strong> (회사 지원 ${formatAmount(l1 + 1 - Math.round((l1 + 1) * r2Ratio))}원)
                </div>
            </div>

            <!-- 다 구간 -->
            <div class="rules-bracket-card bracket-card-c">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.35rem; flex-wrap:wrap; gap:0.3rem;">
                    <span class="rules-bracket-title">다. 초과 누진 (${formatAmount(l2 + 1)}원 ~ ${formatAmount(l3)}원 이하)</span>
                    <span class="rules-bracket-badge">누진 자부담 (초과분 ${r3Pct}%)</span>
                </div>
                <div class="rules-bracket-desc">
                    전체 금액에 ${r3Pct}%를 곱하는 것이 아니라, <strong>앞 ${formatAmount(l2)}원까지는 ${r2Pct}%(${formatAmount(part1)}원)</strong>만 내고, <strong>${formatAmount(l2)}원을 초과한 금액에 대해서만 ${r3Pct}%</strong>를 내도록 누진 적용되어 직원 부담 급증을 완화합니다.
                </div>
                <div class="rules-bracket-example">
                    📌 <strong>예시:</strong><br>
                    • 1인당 <strong>${formatAmount(l2 + 1)}원</strong> 지출 시: 앞 ${formatAmount(l2)}원(${formatAmount(part1)}원) + 초과 1원(0.4원 반올림 0원) ➔ <strong>자부담 ${formatAmount(part1)}원 동일</strong> (회사 지원 ${formatAmount(l2 + 1 - part1)}원)<br>
                    • 1인당 <strong>${formatAmount(l3)}원</strong> 지출 시: 앞 ${formatAmount(l2)}원(${formatAmount(part1)}원) + 초과 ${formatAmount(l3 - l2)}원(${formatAmount(Math.round((l3 - l2) * r3Ratio))}원) ➔ <strong>자부담 ${formatAmount(selfAtL3)}원</strong> (회사 지원 ${formatAmount(corpAtL3)}원)
                </div>
            </div>

            <!-- 라 구간 -->
            <div class="rules-bracket-card bracket-card-d">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.35rem; flex-wrap:wrap; gap:0.3rem;">
                    <span class="rules-bracket-title">라. 한도 초과 (${formatAmount(l3)}원 초과)</span>
                    <span class="rules-bracket-badge">최대 ${formatAmount(ded4)}원 지원 (정액 캡)</span>
                </div>
                <div class="rules-bracket-desc">
                    인당 행사비가 ${formatAmount(l3)}원을 넘으면 회사는 <strong>인당 최대 ${formatAmount(ded4)}원까지만 지원</strong>하며(법인카드 상한), <strong>${formatAmount(ded4)}원을 초과한 잔여 금액은 전액 개인이 부담</strong>합니다. (공식: 인당 행사비 - ${formatAmount(ded4)}원)
                </div>
                <div class="rules-bracket-example">
                    📌 <strong>예시:</strong> 1인당 <strong>${formatAmount(l3 + 1)}원</strong> 지출 시 ➔ <strong>자부담 ${formatAmount(l3 + 1 - ded4)}원</strong> (회사 최대 ${formatAmount(ded4)}원 지원)
                    <div class="rules-bracket-note">
                        💡 <strong>사규 공식 구간 전환 안내:</strong> [다] 구간 최대치(${formatAmount(l3)}원 지출 시 회사 지원 ${formatAmount(corpAtL3)}원 / 자부담 ${formatAmount(selfAtL3)}원) 대비, [라] 구간(${formatAmount(l3 + 1)}원 이상)부터는 회사 지원금이 사규상 최대 지원 한도인 <strong>${formatAmount(ded4)}원</strong>으로 정액 고정 지원되므로 자부담이 ${formatAmount(l3 + 1 - ded4)}원으로 산출됩니다.
                    </div>
                </div>
            </div>

            <!-- 기타 비용 기준 요약 -->
            <div class="rules-extra-box">
                <div class="rules-extra-title">🏢 기타 비용 규정 안내</div>
                <div>• <strong>시설 및 장비 이용료:</strong> 인당 최대 ${formatAmount(facilityLimit)}원 flat 지원 (임원진 사전 승인 필요, 초과분 자부담)</div>
                <div>• <strong>상품비:</strong> 클럽당 연간 최대 ${formatAmount(prizeLimit)}원 한도 (정회원 10명 이상 행사 시 집행 가능)</div>
            </div>

            <!-- 시스템 최신 사용법 & 팁 안내 -->
            <div class="rules-extra-box" style="border-color:rgba(99,102,241,0.35); background:rgba(99,102,241,0.06);">
                <div class="rules-extra-title" style="color:var(--primary, #6366f1);">✨ 최신 사용법 & 편리한 기능 안내</div>
                <div>• <strong>자부담 금액 조정:</strong> [비용 항목 추가/수정] 폼에서 <strong>개인카드</strong> 금액이나 <strong>1인당 자부담</strong>을 원하는 금액으로 직접 입력할 수 있습니다. (사규 최소 자부담 기준 미달 시 자동 방지 및 안내)</div>
                <div>• <strong>전사원 명부 👑 왕관 배지:</strong> 올해 누적 참석 횟수 1위(공동 1등 포함) 사원에게 황금 왕관(👑)이 자동으로 부여됩니다.</div>
                <div>• <strong>사원 등록 & 실시간 동기화:</strong> 이름과 사번만 입력하면 전사원 명부가 모든 접속자에게 실시간 자동 반영됩니다.</div>
            </div>
        </div>
    `;
}

function openRulesGuideModal() {
    renderRulesGuideModalContent();
    const overlay = document.getElementById('rules-guide-modal-overlay');
    if (overlay) overlay.style.display = 'flex';
}

function closeRulesGuideModal() {
    const overlay = document.getElementById('rules-guide-modal-overlay');
    if (overlay) overlay.style.display = 'none';
}

(function initRulesGuideModal() {
    const btn = document.getElementById('expense-rules-guide-btn');
    if (btn) btn.addEventListener('click', openRulesGuideModal);

    const closeBtn = document.getElementById('rules-guide-modal-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', closeRulesGuideModal);

    const confirmBtn = document.getElementById('rules-guide-modal-confirm-btn');
    if (confirmBtn) confirmBtn.addEventListener('click', closeRulesGuideModal);

    const overlay = document.getElementById('rules-guide-modal-overlay');
    if (overlay) {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeRulesGuideModal();
        });
    }
})();

// 전역 커스텀 툴팁 — [data-tooltip] 요소는 어디에 있든(스크롤 컨테이너 내부 포함) 이 위치를 통해
// document.body 기준 position:fixed 로 뜬다. 이벤트 위임 방식이라 나중에 동적으로 그려지는
// 요소(예: innerHTML로 다시 그려지는 클럽 목록 행)에도 별도 등록 없이 자동으로 동작한다.
(function initGlobalTooltip() {
    let tipEl = null;
    function ensureTip() {
        if (!tipEl) {
            tipEl = document.createElement('div');
            tipEl.id = 'global-tooltip';
            document.body.appendChild(tipEl);
        }
        return tipEl;
    }
    function showTip(target) {
        const text = target.getAttribute('data-tooltip');
        if (!text) return;
        const tip = ensureTip();
        tip.textContent = text;
        tip.classList.remove('visible');
        // 실제 크기를 재려면 먼저 그려야 하므로 visibility만 우선 hidden 유지한 채 배치 계산
        const rect = target.getBoundingClientRect();
        const tipRect = tip.getBoundingClientRect();
        let left = rect.left + rect.width / 2 - tipRect.width / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));
        let top = rect.top - tipRect.height - 8;
        if (top < 4) top = rect.bottom + 8; // 위쪽 공간이 부족하면 아래로 표시
        tip.style.left = left + 'px';
        tip.style.top = top + 'px';
        tip.classList.add('visible');
    }
    function hideTip() {
        if (tipEl) tipEl.classList.remove('visible');
    }
    document.addEventListener('mouseover', (e) => {
        const target = e.target.closest && e.target.closest('[data-tooltip]');
        if (target) showTip(target);
    });
    document.addEventListener('mouseout', (e) => {
        const target = e.target.closest && e.target.closest('[data-tooltip]');
        if (target && (!e.relatedTarget || !target.contains(e.relatedTarget))) hideTip();
    });
    document.addEventListener('focusin', (e) => {
        const target = e.target.closest && e.target.closest('[data-tooltip]');
        if (target) showTip(target);
    });
    document.addEventListener('focusout', hideTip);
    window.addEventListener('scroll', hideTip, true);
})();

// 텍스트 입력 모달 (관리자 인라인 수정용)
function showEditModal(title, hint, defaultValue, onConfirm) {
    const existing = document.getElementById('edit-modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'edit-modal-overlay';
    overlay.className = 'edit-modal-overlay';
    overlay.innerHTML = `
        <div class="edit-modal-box">
            <div class="edit-modal-title">✏️ ${title}</div>
            <div class="edit-modal-hint">${hint}</div>
            <input id="edit-modal-input" type="text" value="${defaultValue.replace(/"/g, '&quot;')}" class="edit-modal-input">
            <div class="edit-modal-actions">
                <button id="edit-modal-cancel" class="edit-modal-cancel-btn">취소</button>
                <button id="edit-modal-ok" class="edit-modal-ok-btn">저장</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('#edit-modal-input');
    const okBtn = overlay.querySelector('#edit-modal-ok');
    const cancelBtn = overlay.querySelector('#edit-modal-cancel');

    setTimeout(() => { input.focus(); input.select(); }, 50);

    const close = () => overlay.remove();
    cancelBtn.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    okBtn.addEventListener('click', () => { close(); onConfirm(input.value); });
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { close(); onConfirm(input.value); }
        if (e.key === 'Escape') close();
    });
}

// 확인 커스텀 모달 (테마 적용)
// okLabel 미지정 → 삭제 스타일(빨강), 지정 시 확인 스타일(파랑/보라)
let _activeConfirmModalCleanup = null;
function showConfirmModal(message, onConfirm, okLabel, customTitle, customIcon, onCancel) {
    const overlay = document.getElementById('confirm-modal-overlay');
    const msgEl = document.getElementById('confirm-modal-msg');
    const okBtn = document.getElementById('confirm-modal-ok');
    const cancelBtn = document.getElementById('confirm-modal-cancel');
    if (!overlay || !msgEl) {
        if (confirm(message)) { onConfirm && onConfirm(); } else { onCancel && onCancel(); }
        return;
    }

    if (typeof _activeConfirmModalCleanup === 'function') {
        _activeConfirmModalCleanup();
    }

    const isDelete = !okLabel;
    const isLight = document.documentElement.getAttribute('data-app-theme') === 'light';
    const box = document.getElementById('confirm-modal-box');
    const iconEl = document.getElementById('confirm-modal-icon');
    const titleEl = document.getElementById('confirm-modal-title');

    msgEl.textContent = message;

    if (isDelete) {
        if (box) {
            box.style.borderColor = isLight ? 'rgba(239,68,68,0.5)' : 'rgba(239,68,68,0.55)';
            box.style.boxShadow = isLight ? '0 16px 48px rgba(239,68,68,0.15)' : '0 0 40px rgba(239,68,68,0.22), 0 12px 48px rgba(0,0,0,0.7)';
        }
        if (iconEl) iconEl.textContent = customIcon || '🗑️';
        if (titleEl) {
            titleEl.textContent = customTitle || '삭제 확인';
            titleEl.style.color = isLight ? '#dc2626' : 'rgba(239,68,68,0.7)';
        }
        okBtn.textContent = '삭제';
        okBtn.style.background = isLight ? '#dc2626' : 'rgba(239,68,68,0.25)';
        okBtn.style.border = isLight ? 'none' : '2px solid rgba(239,68,68,0.65)';
        okBtn.style.color = isLight ? '#ffffff' : '#fca5a5';
    } else {
        if (box) {
            box.style.borderColor = isLight ? 'rgba(99,102,241,0.4)' : 'rgba(99,102,241,0.55)';
            box.style.boxShadow = isLight ? '0 16px 48px rgba(15,23,42,0.18)' : '0 0 40px rgba(99,102,241,0.18), 0 12px 48px rgba(0,0,0,0.7)';
        }
        if (iconEl) iconEl.textContent = customIcon || '✅';
        if (titleEl) {
            titleEl.textContent = customTitle || '확인';
            titleEl.style.color = isLight ? '#4338ca' : 'rgba(99,102,241,0.8)';
        }
        okBtn.textContent = okLabel;
        okBtn.style.background = isLight ? '#4f46e5' : 'rgba(99,102,241,0.25)';
        okBtn.style.border = isLight ? 'none' : '2px solid rgba(99,102,241,0.65)';
        okBtn.style.color = isLight ? '#ffffff' : '#c7d2fe';
    }

    if (cancelBtn) {
        cancelBtn.style.display = onConfirm ? 'inline-block' : 'none';
    }

    overlay.style.display = 'flex';

    const cleanup = () => {
        overlay.style.display = 'none';
        okBtn.removeEventListener('click', handleOk);
        cancelBtn.removeEventListener('click', handleCancel);
        overlay.removeEventListener('click', handleOverlay);
        document.removeEventListener('keydown', handleKey);
        _activeConfirmModalCleanup = null;
    };
    _activeConfirmModalCleanup = cleanup;
    const handleOk = () => { cleanup(); onConfirm && onConfirm(); };
    const handleCancel = () => { cleanup(); onCancel && onCancel(); };
    const handleOverlay = (e) => { if (e.target === overlay) { cleanup(); onCancel && onCancel(); } };
    const handleKey = (e) => { if (e.key === 'Escape') { cleanup(); onCancel && onCancel(); } };

    okBtn.addEventListener('click', handleOk);
    cancelBtn.addEventListener('click', handleCancel);
    overlay.addEventListener('click', handleOverlay);
    document.addEventListener('keydown', handleKey);
}

// 브라우저 상단 alert() 대신 화면 정가운데 인앱 팝업으로 표시
const _nativeWindowAlert = (typeof window !== 'undefined' && typeof window.alert === 'function')
    ? window.alert.bind(window)
    : null;
function showAlertModal(message, customTitle, customIcon) {
    const text = String(message ?? '');
    const overlay = document.getElementById('confirm-modal-overlay');
    const msgEl = document.getElementById('confirm-modal-msg');
    if (!overlay || !msgEl) {
        if (_nativeWindowAlert) _nativeWindowAlert(text);
        return;
    }
    const isErr = /실패|오류|불가|없습니다|삭제|❌|🚨|⚠️/.test(text);
    const isDone = /완료|저장|복사|발송/.test(text) && !isErr;
    const icon = customIcon || (isErr ? '⚠️' : (isDone ? '✅' : 'ℹ️'));
    const title = customTitle || (isErr ? '안내' : (isDone ? '완료' : '알림'));
    showConfirmModal(text, null, '확인', title, icon);
}
if (typeof window !== 'undefined') {
    window.showAlertModal = showAlertModal;
    window.alert = (msg) => showAlertModal(msg);
}

function showPrizeModal(message, onOk, type) {
    const overlay = document.getElementById('prize-modal-overlay');
    const msgEl = document.getElementById('prize-modal-msg');
    const iconEl = document.getElementById('prize-modal-icon');
    const okBtn = document.getElementById('prize-modal-ok');
    if (!overlay || !msgEl) { alert(message); if (onOk) onOk(); return; }

    msgEl.textContent = message;
    if (iconEl) iconEl.textContent = type === 'block' ? '🚫' : type === 'warn' ? '⚠️' : '🎁';
    overlay.style.display = 'flex';
    if (okBtn) okBtn.focus();

    let isClosed = false;
    const cleanup = () => {
        if (isClosed) return;
        isClosed = true;
        overlay.style.display = 'none';
        if (okBtn) okBtn.removeEventListener('click', handleOk);
        document.removeEventListener('keydown', handleKey);
        if (onOk) onOk();
    };
    const handleOk = () => cleanup();
    const handleKey = (e) => {
        if (e.key === 'Escape' || e.key === 'Enter') {
            e.preventDefault();
            cleanup();
        }
    };
    if (okBtn) okBtn.addEventListener('click', handleOk);
    document.addEventListener('keydown', handleKey);
}

function formatMediaSize(bytes) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1).replace('.0', '')}MB`;
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('이미지 파일을 읽지 못했습니다.'));
        reader.readAsDataURL(file);
    });
}

function loadImageFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('이미지를 해석하지 못했습니다.'));
        image.src = dataUrl;
    });
}

function canvasToBlob(canvas, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            if (blob) resolve(blob);
            else reject(new Error('이미지 압축에 실패했습니다.'));
        }, 'image/jpeg', quality);
    });
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('압축 이미지를 변환하지 못했습니다.'));
        reader.readAsDataURL(blob);
    });
}

// 긴 세로 영수증도 긴 변 기준으로 축소하고, 목표 바이트에 도달할 때까지 품질·해상도를 단계적으로 낮춘다.
async function compressImageForStorage(file, policy = MediaStoragePolicy.receipt) {
    if (!file || !file.type || !file.type.startsWith('image/')) {
        throw new Error('이미지 파일만 첨부할 수 있습니다.');
    }
    const source = await readFileAsDataUrl(file);
    const image = await loadImageFromDataUrl(source);
    const originalLongest = Math.max(image.width, image.height);
    let scale = Math.min(1, policy.maxDimension / Math.max(1, originalLongest));
    let best = null;

    for (let stage = 0; stage < 5; stage++) {
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        // PNG 투명 영역이 JPEG 변환 시 검게 보이지 않도록 흰 배경을 먼저 채운다.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(image, 0, 0, width, height);

        for (let quality = policy.quality; quality >= policy.minQuality - 0.001; quality -= 0.08) {
            const blob = await canvasToBlob(canvas, Math.max(policy.minQuality, quality));
            if (!best || blob.size < best.blob.size) best = { blob, width, height };
            if (blob.size <= policy.targetBytes) {
                return { dataUrl: await blobToDataUrl(blob), bytes: blob.size, width, height };
            }
        }

        if (Math.max(width, height) <= policy.minDimension) break;
        scale *= 0.76;
    }

    if (!best) throw new Error('이미지 압축에 실패했습니다.');
    return {
        dataUrl: await blobToDataUrl(best.blob),
        bytes: best.blob.size,
        width: best.width,
        height: best.height
    };
}

// 기존 콜백 호출부와의 호환용 래퍼
function compressReceiptImage(file, callback, policy = MediaStoragePolicy.receipt, onError) {
    compressImageForStorage(file, policy)
        .then(({ dataUrl, bytes }) => callback(dataUrl, bytes))
        .catch(err => {
            console.error('이미지 압축 실패:', err);
            if (onError) onError(err);
            else alert(err.message || '이미지 압축에 실패했습니다.');
        });
}
