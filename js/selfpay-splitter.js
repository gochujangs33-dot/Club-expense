// ============================================================
// js/selfpay-splitter.js — 모션그래픽 인터랙티브 자부담 정산기
// ============================================================
// v1.7.89: 모션그래픽 UI 전면 개편 + 면제·룰렛·수동금액 재분배 정밀 보정
//   - 실시간 지분율 모션 바 (참석자별 색상 매칭)
//   - 스탬프·마그네틱 합체·룰렛 스포트라이트 모션그래픽
//   - 면제 토글 시 룰렛 잠금 자동 해제 및 잔여금 100% 정확한 재분배

(function () {
    'use strict';

    const PERSON_PALETTE = [
        '#6366f1', '#10b981', '#f59e0b', '#ec4899',
        '#06b6d4', '#8b5cf6', '#f97316', '#14b8a6',
        '#3b82f6', '#eab308', '#ef4444', '#84cc16'
    ];

    function resolveRootPayer(participantsMap, startId) {
        let curId = startId;
        const visited = new Set();
        while (curId && participantsMap.has(curId)) {
            if (visited.has(curId)) return null;
            visited.add(curId);
            const node = participantsMap.get(curId);
            if (!node || node.exempt) return null;
            if (!node.paidBy || node.paidBy === curId) return node.id;
            curId = node.paidBy;
        }
        return null;
    }

    const SelfPaySplitterEngine = Object.freeze({
        compute(totalSelfPay, rawParticipants) {
            const total = Math.max(0, Math.round(Number(totalSelfPay) || 0));
            const list = Array.isArray(rawParticipants) ? rawParticipants.map((p, idx) => ({
                id: String(p.id ?? idx),
                index: idx + 1,
                color: p.color || PERSON_PALETTE[idx % PERSON_PALETTE.length],
                name: String(p.name || `참석자 ${idx + 1}`).trim(),
                employeeId: String(p.employeeId || '').trim(),
                exempt: Boolean(p.exempt),
                paidBy: p.paidBy ? String(p.paidBy) : null,
                manualAmount: (p.manualAmount !== null && p.manualAmount !== undefined && p.manualAmount !== '' && Number.isFinite(Number(p.manualAmount)))
                    ? Math.max(0, Math.round(Number(p.manualAmount)))
                    : null,
                rouletteTag: p.rouletteTag || null,
                isRouletteLocked: Boolean(p.isRouletteLocked)
            })) : [];

            const map = new Map(list.map(p => [p.id, p]));

            // 1. 면제 및 순환 paidBy 정리
            list.forEach(p => {
                if (p.exempt) {
                    p.paidBy = null;
                    p.manualAmount = null;
                    p.rouletteTag = null;
                    p.isRouletteLocked = false;
                    return;
                }
                if (p.paidBy) {
                    const rootId = resolveRootPayer(map, p.paidBy);
                    if (!rootId || rootId === p.id) {
                        p.paidBy = null;
                    } else {
                        p.paidBy = rootId;
                        p.manualAmount = null;
                        p.rouletteTag = null;
                        p.isRouletteLocked = false;
                    }
                }
            });

            // 2. 루트 결제자별 대신 내주는 인원 집계
            const coveredByRoot = new Map();
            list.forEach(p => {
                if (!p.exempt && p.paidBy) {
                    if (!coveredByRoot.has(p.paidBy)) coveredByRoot.set(p.paidBy, []);
                    coveredByRoot.get(p.paidBy).push(p);
                }
            });

            let manualSum = 0;
            let totalAutoShares = 0;
            const autoRoots = [];

            list.forEach(p => {
                const covered = coveredByRoot.get(p.id) || [];
                p.coveredMembers = covered.map(c => ({ id: c.id, index: c.index, name: c.name, color: c.color, employeeId: c.employeeId }));
                if (p.exempt) {
                    p.role = 'exempt';
                    p.shareCount = 0;
                    p.finalAmount = 0;
                } else if (p.paidBy) {
                    const payer = map.get(p.paidBy);
                    p.role = 'covered';
                    p.paidByName = payer ? payer.name : '';
                    p.paidByIndex = payer ? payer.index : 0;
                    p.shareCount = 0;
                    p.finalAmount = 0;
                } else {
                    p.role = 'payer';
                    p.shareCount = 1 + covered.length;
                    if (p.manualAmount !== null) {
                        p.finalAmount = p.manualAmount;
                        manualSum += p.finalAmount;
                    } else {
                        totalAutoShares += p.shareCount;
                        autoRoots.push(p);
                    }
                }
            });

            const remainingPool = Math.max(0, total - manualSum);
            const overAllocated = manualSum > total ? (manualSum - total) : 0;
            const basePerShare = totalAutoShares > 0 ? Math.floor(remainingPool / totalAutoShares) : 0;

            let distributedAuto = 0;
            autoRoots.forEach((p) => {
                p.finalAmount = basePerShare * p.shareCount;
                distributedAuto += p.finalAmount;
            });

            const remainder = remainingPool - distributedAuto;
            if (remainder > 0 && autoRoots.length > 0) {
                autoRoots[autoRoots.length - 1].finalAmount += remainder;
            }

            const activeParticipantCount = list.filter(p => !p.exempt).length;
            const exemptCount = list.filter(p => p.exempt).length;
            const equalReference = activeParticipantCount > 0 ? Math.round(total / activeParticipantCount) : 0;

            return {
                totalSelfPay: total,
                manualSum,
                remainingPool,
                overAllocated,
                totalAutoShares,
                basePerShare,
                remainder,
                perShare: totalAutoShares > 0 ? Math.round(remainingPool / totalAutoShares) : 0,
                equalReference,
                activeParticipantCount,
                exemptCount,
                items: list
            };
        }
    });

    window.SelfPaySplitterEngine = SelfPaySplitterEngine;

    // ── 모션 상태 관리 ─────────────────────────────────────────
    let currentState = {
        clubName: '',
        settlementDate: '',
        totalSelfPay: 0,
        originalSelfPay: 0,
        participants: [],
        draggingId: null,
        pulseIds: new Set(),
        exemptPulseId: null,
        winnerPulseId: null,
        openDelegateId: null,
        isSpinning: false,
        prevAmounts: new Map()
    };

    function fmtNum(n) {
        return new Intl.NumberFormat('ko-KR').format(Math.round(Number(n) || 0));
    }

    function parseNum(str) {
        const cleaned = String(str || '').replace(/[^\d]/g, '');
        return cleaned ? parseInt(cleaned, 10) : 0;
    }

    function escapeHtml(str) {
        if (typeof AppState !== 'undefined' && typeof AppState.escapeHtml === 'function') {
            return AppState.escapeHtml(str);
        }
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function animateTextNumber(el, fromVal, toVal, suffix = '원') {
        if (!el) return;
        const start = Math.round(Number(fromVal) || 0);
        const end = Math.round(Number(toVal) || 0);
        if (start === end) {
            el.textContent = `${fmtNum(end)}${suffix}`;
            return;
        }
        const duration = 320;
        const t0 = performance.now();
        function frame(now) {
            const p = Math.min(1, (now - t0) / duration);
            const eased = 1 - Math.pow(1 - p, 3);
            const cur = Math.round(start + (end - start) * eased);
            el.textContent = `${fmtNum(cur)}${suffix}`;
            if (p < 1) requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
    }

    function ensureModalDom() {
        let modal = document.getElementById('selfpay-splitter-modal');
        if (modal) return modal;

        modal = document.createElement('div');
        modal.id = 'selfpay-splitter-modal';
        modal.className = 'modal hidden';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'selfpay-splitter-title');
        modal.innerHTML = `
            <div class="modal-content-card card selfpay-splitter-modal-card">
                <div class="selfpay-hero-banner">
                    <div class="selfpay-hero-glow" aria-hidden="true"></div>
                    <div class="selfpay-hero-left">
                        <span class="selfpay-hero-icon" aria-hidden="true">🎮</span>
                        <div class="selfpay-splitter-title-wrap">
                            <h2 id="selfpay-splitter-title">자부담 더치페이 정산기</h2>
                            <small id="selfpay-splitter-subtitle" class="selfpay-splitter-subtitle"></small>
                        </div>
                    </div>
                    <button type="button" id="close-selfpay-splitter-modal" class="attendance-roster-close selfpay-hero-close" aria-label="자부담 정산기 닫기">&times;</button>
                </div>

                <div class="card-body selfpay-splitter-body">
                    <div class="selfpay-dashboard-bar">
                        <div class="selfpay-stat-box is-total">
                            <span class="selfpay-stat-label">총 자부담 금액</span>
                            <div class="selfpay-total-edit-wrap">
                                <input type="text" inputmode="numeric" id="selfpay-total-input" class="selfpay-total-input" aria-label="총 자부담 금액">
                                <span class="selfpay-unit">원</span>
                            </div>
                        </div>
                        <div class="selfpay-stat-box is-share">
                            <span class="selfpay-stat-label">기본 1인분 <small id="selfpay-active-count-label"></small></span>
                            <strong id="selfpay-per-share-val" class="selfpay-stat-val">0원</strong>
                        </div>
                        <div class="selfpay-stat-box is-status">
                            <span class="selfpay-stat-label">정산 밸런스</span>
                            <strong id="selfpay-balance-status" class="selfpay-stat-status">✅ 분배 완료</strong>
                        </div>
                    </div>

                    <div class="selfpay-split-bar-section">
                        <div class="selfpay-split-bar-header">
                            <span>실시간 부담 비율</span>
                            <small id="selfpay-split-bar-hint">카드를 끌어다 합체하거나, 금액을 수정해 보세요</small>
                        </div>
                        <div id="selfpay-split-bar-track" class="selfpay-split-bar-track" aria-label="실시간 부담 비율 바"></div>
                    </div>

                    <div class="selfpay-action-toolbar">
                        <div class="selfpay-guide-pill">
                            <span class="selfpay-guide-dot"></span>
                            <span><strong>드래그</strong>로 대신 내주기 합체 · <strong>면제</strong>로 제외 · <strong>금액 수정</strong> 시 잔여금 자동 분배</span>
                        </div>
                        <div class="selfpay-game-btns">
                            <button type="button" id="selfpay-roulette-change-btn" class="selfpay-motion-btn is-dice" title="전원 1,000원 단위로 맞추고 자투리 금액을 룰렛 당첨자 1명에게 몰아줍니다">🎲 1,000원 자투리 룰렛</button>
                            <button type="button" id="selfpay-roulette-allin-btn" class="selfpay-motion-btn is-slot" title="면제자를 제외한 인원 중 1명을 추첨해 오늘의 골든벨 주인공으로 뽑습니다">🎰 골든벨 1명 뽑기</button>
                            <button type="button" id="selfpay-reset-all-btn" class="selfpay-motion-btn is-reset">↺ 1/N 초기화</button>
                        </div>
                    </div>

                    <div id="selfpay-cards-grid" class="selfpay-cards-grid"></div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        document.getElementById('close-selfpay-splitter-modal')?.addEventListener('click', closeSelfPaySplitterModal);
        modal.addEventListener('click', e => {
            if (e.target === modal) closeSelfPaySplitterModal();
            else if (!e.target.closest('.selfpay-delegate-wrap')) {
                if (currentState.openDelegateId !== null) {
                    currentState.openDelegateId = null;
                    renderSplitter();
                }
            }
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
                if (currentState.openDelegateId !== null) {
                    currentState.openDelegateId = null;
                    renderSplitter();
                } else {
                    closeSelfPaySplitterModal();
                }
            }
        });

        const totalInput = document.getElementById('selfpay-total-input');
        if (totalInput) {
            totalInput.addEventListener('change', () => {
                currentState.totalSelfPay = parseNum(totalInput.value);
                renderSplitter();
            });
            totalInput.addEventListener('keydown', e => {
                if (e.key === 'Enter') totalInput.blur();
            });
        }

        document.getElementById('selfpay-reset-all-btn')?.addEventListener('click', () => {
            if (currentState.isSpinning) return;
            currentState.totalSelfPay = currentState.originalSelfPay;
            currentState.openDelegateId = null;
            currentState.participants.forEach(p => {
                p.exempt = false;
                p.paidBy = null;
                p.manualAmount = null;
                p.rouletteTag = null;
                p.isRouletteLocked = false;
            });
            renderSplitter();
        });

        document.getElementById('selfpay-roulette-change-btn')?.addEventListener('click', () => runRoulette('change'));
        document.getElementById('selfpay-roulette-allin-btn')?.addEventListener('click', () => runRoulette('allin'));

        return modal;
    }

    function clearRouletteLocks() {
        currentState.participants.forEach(p => {
            if (p.isRouletteLocked) {
                p.manualAmount = null;
                p.rouletteTag = null;
                p.isRouletteLocked = false;
            }
        });
    }

    function runRoulette(mode) {
        if (currentState.isSpinning) return;
        const candidates = currentState.participants.filter(p => !p.exempt);
        if (candidates.length < 2 || currentState.totalSelfPay <= 0) return;

        currentState.openDelegateId = null;
        currentState.participants.forEach(p => {
            p.paidBy = null;
            p.manualAmount = null;
            p.rouletteTag = null;
            p.isRouletteLocked = false;
        });
        renderSplitter();

        currentState.isSpinning = true;
        const grid = document.getElementById('selfpay-cards-grid');
        const totalSteps = 15 + Math.floor(Math.random() * candidates.length);
        const winnerIdx = totalSteps % candidates.length;
        let step = 0;

        const tick = () => {
            const activeCandidate = candidates[step % candidates.length];
            if (grid) {
                grid.querySelectorAll('.selfpay-person-card').forEach(card => {
                    card.classList.toggle('is-roulette-cursor', card.dataset.pid === activeCandidate.id);
                });
            }
            step++;
            if (step <= totalSteps) {
                const progress = step / totalSteps;
                const delay = 45 + Math.round(Math.pow(progress, 2) * 190);
                setTimeout(tick, delay);
            } else {
                currentState.isSpinning = false;
                const winner = candidates[winnerIdx];
                if (mode === 'allin') {
                    candidates.forEach(p => {
                        p.isRouletteLocked = true;
                        if (p.id === winner.id) {
                            p.manualAmount = currentState.totalSelfPay;
                            p.rouletteTag = '🎯 골든벨 당첨!';
                        } else {
                            p.manualAmount = 0;
                        }
                    });
                } else {
                    const baseUnit = Math.floor((currentState.totalSelfPay / candidates.length) / 1000) * 1000;
                    const remainder = currentState.totalSelfPay - (baseUnit * candidates.length);
                    candidates.forEach(p => {
                        p.isRouletteLocked = true;
                        if (p.id === winner.id) {
                            p.manualAmount = baseUnit + remainder;
                            p.rouletteTag = remainder > 0 ? `🎲 자투리 +${fmtNum(remainder)}원` : '🎲 당첨!';
                        } else {
                            p.manualAmount = baseUnit;
                        }
                    });
                }
                currentState.winnerPulseId = winner.id;
                renderSplitter();
            }
        };
        tick();
    }

    function getRoleBadgeHtml(item, equalRef) {
        if (item.rouletteTag) {
            return `<span class="selfpay-role-badge badge-roulette">${escapeHtml(item.rouletteTag)}</span>`;
        }
        if (item.role === 'exempt') {
            return `<span class="selfpay-role-badge badge-exempt">🎟️ 면제됨</span>`;
        }
        if (item.role === 'covered') {
            return `<span class="selfpay-role-badge badge-covered">🤝 ${item.paidByIndex}번 대납</span>`;
        }
        if (item.shareCount >= 3) {
            return `<span class="selfpay-role-badge badge-hero">👑 ${item.shareCount}인분 골든벨</span>`;
        }
        if (item.shareCount === 2) {
            return `<span class="selfpay-role-badge badge-angel">👼 2인분 합산</span>`;
        }
        if (item.manualAmount !== null) {
            if (item.finalAmount > equalRef) {
                return `<span class="selfpay-role-badge badge-generous">🎩 쾌척 고정</span>`;
            }
            return `<span class="selfpay-role-badge badge-locked">🔒 금액 고정</span>`;
        }
        return `<span class="selfpay-role-badge badge-normal">⚖️ 1인분</span>`;
    }

    function mergeParticipantInto(sourceId, targetId) {
        if (!sourceId || !targetId || sourceId === targetId) return;
        const src = currentState.participants.find(p => p.id === sourceId);
        const tgt = currentState.participants.find(p => p.id === targetId);
        if (!src || !tgt) return;

        clearRouletteLocks();
        currentState.openDelegateId = null;

        const actualTargetId = (!tgt.exempt && tgt.paidBy) ? tgt.paidBy : tgt.id;
        if (actualTargetId === src.id) return;
        const actualTarget = currentState.participants.find(p => p.id === actualTargetId);
        if (!actualTarget) return;

        actualTarget.exempt = false;
        actualTarget.paidBy = null;
        actualTarget.manualAmount = null;
        actualTarget.rouletteTag = null;

        currentState.participants.forEach(p => {
            if (p.paidBy === src.id) {
                p.paidBy = actualTarget.id;
            }
        });

        src.exempt = false;
        src.paidBy = actualTarget.id;
        src.manualAmount = null;
        src.rouletteTag = null;

        currentState.pulseIds.add(actualTarget.id);
        renderSplitter();
    }

    function renderSplitBar(computed) {
        const track = document.getElementById('selfpay-split-bar-track');
        if (!track) return;
        const activePayers = computed.items.filter(it => it.role === 'payer' && it.finalAmount > 0);
        const denom = Math.max(computed.totalSelfPay, activePayers.reduce((s, i) => s + i.finalAmount, 0));
        if (denom <= 0 || activePayers.length === 0) {
            track.innerHTML = '<div class="selfpay-split-bar-empty">분배할 금액이 없습니다</div>';
            return;
        }
        track.innerHTML = activePayers.map(p => {
            const pct = (p.finalAmount / denom) * 100;
            return `<div class="selfpay-split-segment" style="width:${pct.toFixed(2)}%; background:${p.color};" title="${escapeHtml(p.name)}: ${fmtNum(p.finalAmount)}원 (${pct.toFixed(1)}%)"></div>`;
        }).join('');
    }

    function renderSplitter() {
        const totalInput = document.getElementById('selfpay-total-input');
        if (totalInput && document.activeElement === totalInput) {
            currentState.totalSelfPay = parseNum(totalInput.value);
        }

        const computed = SelfPaySplitterEngine.compute(currentState.totalSelfPay, currentState.participants);

        if (totalInput && document.activeElement !== totalInput) {
            totalInput.value = fmtNum(computed.totalSelfPay);
        }

        const activeLabelEl = document.getElementById('selfpay-active-count-label');
        if (activeLabelEl) {
            activeLabelEl.textContent = computed.exemptCount > 0
                ? `(참여 ${computed.activeParticipantCount}명 · 면제 ${computed.exemptCount}명)`
                : `(${computed.activeParticipantCount}명 균등)`;
        }

        const perShareEl = document.getElementById('selfpay-per-share-val');
        if (perShareEl) {
            const prevPer = perShareEl.dataset.prevVal ? Number(perShareEl.dataset.prevVal) : computed.basePerShare;
            perShareEl.dataset.prevVal = String(computed.basePerShare);
            if (computed.totalAutoShares === 0) {
                perShareEl.textContent = '수동/면제';
            } else if (computed.remainder > 0) {
                perShareEl.textContent = `${fmtNum(computed.basePerShare)}원 (+${fmtNum(computed.remainder)}원)`;
            } else {
                animateTextNumber(perShareEl, prevPer, computed.basePerShare, '원');
            }
        }

        const statusEl = document.getElementById('selfpay-balance-status');
        if (statusEl) {
            const allocatedSum = computed.items.reduce((s, it) => s + (it.finalAmount || 0), 0);
            if (computed.overAllocated > 0) {
                statusEl.textContent = `⚠️ ${fmtNum(computed.overAllocated)}원 초과`;
                statusEl.style.color = '#ef4444';
            } else if (allocatedSum !== computed.totalSelfPay && computed.totalSelfPay > 0) {
                statusEl.textContent = `⚠️ 미배정 ${fmtNum(computed.totalSelfPay - allocatedSum)}원`;
                statusEl.style.color = '#f59e0b';
            } else {
                statusEl.textContent = `✅ ${fmtNum(allocatedSum)}원 딱 맞음`;
                statusEl.style.color = 'var(--color-secondary)';
            }
        }

        renderSplitBar(computed);

        const grid = document.getElementById('selfpay-cards-grid');
        if (!grid) return;

        const activePayers = computed.items.filter(it => it.role === 'payer');

        // 대신 내주기로 합체된 인원(covered)은 바깥 그리드에서 숨기고, 대신 내주는 큰 카드 내부의 작은 카드로 배치한다.
        const visibleItems = computed.items.filter(item => item.role !== 'covered');

        grid.innerHTML = visibleItems.map(item => {
            const isPayer = item.role === 'payer';
            const isExempt = item.role === 'exempt';
            const isCovered = item.role === 'covered';
            const prevAmt = currentState.prevAmounts.get(item.id);
            const changedAmount = prevAmt !== undefined && prevAmt !== item.finalAmount;

            const cardClasses = [
                'selfpay-person-card',
                isExempt ? 'is-exempt' : '',
                isCovered ? 'is-covered' : '',
                item.shareCount >= 2 ? 'is-multi-payer' : '',
                item.manualAmount !== null && !item.isRouletteLocked ? 'is-manual-locked' : '',
                currentState.pulseIds.has(item.id) ? 'just-merged' : '',
                currentState.exemptPulseId === item.id ? 'just-exempted' : '',
                currentState.winnerPulseId === item.id ? 'just-winner' : '',
                changedAmount ? 'amount-popped' : ''
            ].filter(Boolean).join(' ');

            const coveredChipsHtml = item.coveredMembers.length > 0
                ? `<div class="selfpay-nested-cards">
                    ${item.coveredMembers.map(cm => `
                        <div class="selfpay-nested-mini-card">
                            <span class="selfpay-nested-num" style="background:${cm.color || '#6366f1'};">${cm.index}</span>
                            <div class="selfpay-nested-info">
                                <strong>${escapeHtml(cm.name)}</strong>
                                <small>${cm.employeeId ? `${escapeHtml(cm.employeeId)} · ` : ''}0원 (대납)</small>
                            </div>
                            <button type="button" class="selfpay-unmerge-chip-btn" data-unmerge-id="${escapeHtml(cm.id)}" title="다시 밖으로 꺼내기" aria-label="${escapeHtml(cm.name)} 분리">&times;</button>
                        </div>
                    `).join('')}
                   </div>`
                : '';

            const amountSectionHtml = isPayer
                ? `<div class="selfpay-amount-edit-row">
                        <input type="text" inputmode="numeric" class="selfpay-person-amount-input" data-pid="${escapeHtml(item.id)}" value="${fmtNum(item.finalAmount)}" aria-label="${escapeHtml(item.name)} 부담 금액">
                        <span class="selfpay-person-unit">원</span>
                        ${item.manualAmount !== null
                            ? `<button type="button" class="selfpay-unlock-btn" data-unlock-id="${escapeHtml(item.id)}" title="수동 고정을 풀고 자동 분배로 되돌립니다">🔓 자동</button>`
                            : ''}
                   </div>`
                : `<div class="selfpay-amount-zero-row">
                        <strong>0원</strong>
                        <small>${isExempt ? '이번 행사 자부담 면제' : `${item.paidByIndex}번 ${escapeHtml(item.paidByName)}님에게 합산`}</small>
                   </div>`;

            const otherPayers = activePayers.filter(p => p.id !== item.id);
            const isDelegateOpen = currentState.openDelegateId === item.id;
            const delegatePopoverHtml = (isPayer && otherPayers.length > 0)
                ? `<div class="selfpay-delegate-wrap">
                        <button type="button" class="selfpay-pill-btn selfpay-delegate-toggle ${isDelegateOpen ? 'is-open' : ''}" data-delegate-toggle="${escapeHtml(item.id)}">
                            🤝 대신 내주기
                        </button>
                        ${isDelegateOpen ? `
                            <div class="selfpay-delegate-popover" role="menu">
                                <div class="selfpay-delegate-popover-title">누구에게 몫을 넘길까요?</div>
                                ${otherPayers.map(op => `
                                    <button type="button" class="selfpay-delegate-option" data-src="${escapeHtml(item.id)}" data-tgt="${escapeHtml(op.id)}">
                                        <span class="selfpay-dot" style="background:${op.color};"></span>
                                        <span>${op.index}번 ${escapeHtml(op.name)}</span>
                                    </button>
                                `).join('')}
                            </div>
                        ` : ''}
                   </div>`
                : '';

            return `
                <div class="${cardClasses}" data-pid="${escapeHtml(item.id)}" draggable="${!isExempt}" style="--person-color:${item.color};">
                    <div class="selfpay-card-accent" aria-hidden="true"></div>
                    <div class="selfpay-card-top">
                        <div class="selfpay-person-identity">
                            <span class="selfpay-person-num" style="background:${item.color};">${item.index}</span>
                            <div class="selfpay-name-col">
                                <strong class="selfpay-person-name">${escapeHtml(item.name)}</strong>
                                ${item.employeeId ? `<small class="selfpay-person-empid">${escapeHtml(item.employeeId)}</small>` : ''}
                            </div>
                        </div>
                        ${getRoleBadgeHtml(item, computed.equalReference)}
                    </div>

                    ${coveredChipsHtml}
                    ${amountSectionHtml}

                    <div class="selfpay-card-actions">
                        <button type="button" class="selfpay-pill-btn selfpay-exempt-btn ${isExempt ? 'is-active' : ''}" data-exempt-id="${escapeHtml(item.id)}">
                            ${isExempt ? '↩ 면제 해제' : '🎟️ 면제'}
                        </button>
                        ${isCovered
                            ? `<button type="button" class="selfpay-pill-btn selfpay-separate-btn" data-unmerge-id="${escapeHtml(item.id)}">↩ 본인 부담으로</button>`
                            : delegatePopoverHtml}
                    </div>
                </div>
            `;
        }).join('');

        currentState.prevAmounts = new Map(computed.items.map(it => [it.id, it.finalAmount]));
        currentState.pulseIds.clear();
        currentState.exemptPulseId = null;
        currentState.winnerPulseId = null;

        bindCardEvents(grid);
    }

    function bindCardEvents(grid) {
        // 1. 면제 토글 (클릭 시 룰렛 잠금 해제 후 정확한 재분배 보장)
        grid.querySelectorAll('[data-exempt-id]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                if (currentState.isSpinning) return;
                const pid = btn.getAttribute('data-exempt-id');
                const target = currentState.participants.find(p => p.id === pid);
                if (!target) return;

                clearRouletteLocks();
                currentState.openDelegateId = null;

                target.exempt = !target.exempt;
                target.paidBy = null;
                target.manualAmount = null;
                target.rouletteTag = null;
                target.isRouletteLocked = false;
                if (target.exempt) {
                    currentState.exemptPulseId = target.id;
                    currentState.participants.forEach(p => {
                        if (p.paidBy === target.id) p.paidBy = null;
                    });
                }
                renderSplitter();
            });
        });

        // 2. 대신 내주기 분리
        grid.querySelectorAll('[data-unmerge-id]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const pid = btn.getAttribute('data-unmerge-id');
                const target = currentState.participants.find(p => p.id === pid);
                if (!target) return;
                const oldPayerId = target.paidBy;
                target.paidBy = null;
                target.manualAmount = null;
                target.rouletteTag = null;
                if (oldPayerId) {
                    const oldPayer = currentState.participants.find(p => p.id === oldPayerId);
                    if (oldPayer) oldPayer.manualAmount = null;
                }
                renderSplitter();
            });
        });

        // 3. 대신 내주기 팝오버 토글 및 대상 선택
        grid.querySelectorAll('[data-delegate-toggle]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const pid = btn.getAttribute('data-delegate-toggle');
                currentState.openDelegateId = currentState.openDelegateId === pid ? null : pid;
                renderSplitter();
            });
        });
        grid.querySelectorAll('.selfpay-delegate-option').forEach(opt => {
            opt.addEventListener('click', e => {
                e.stopPropagation();
                const srcId = opt.getAttribute('data-src');
                const tgtId = opt.getAttribute('data-tgt');
                mergeParticipantInto(srcId, tgtId);
            });
        });

        // 4. 특정 인원 금액 직접 수정 (남은 잔여금 자동 분배)
        grid.querySelectorAll('.selfpay-person-amount-input').forEach(input => {
            input.addEventListener('focus', () => input.select());
            input.addEventListener('keydown', e => {
                if (e.key === 'Enter') input.blur();
            });
            input.addEventListener('change', () => {
                const pid = input.getAttribute('data-pid');
                const target = currentState.participants.find(p => p.id === pid);
                if (!target) return;
                clearRouletteLocks();
                target.manualAmount = parseNum(input.value);
                target.rouletteTag = null;
                target.isRouletteLocked = false;
                renderSplitter();
            });
        });

        // 5. 수동 고정 해제
        grid.querySelectorAll('[data-unlock-id]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const pid = btn.getAttribute('data-unlock-id');
                const target = currentState.participants.find(p => p.id === pid);
                if (!target) return;
                target.manualAmount = null;
                target.rouletteTag = null;
                target.isRouletteLocked = false;
                renderSplitter();
            });
        });

        // 6. 드래그 & 드롭 합체
        grid.querySelectorAll('.selfpay-person-card').forEach(card => {
            const pid = card.getAttribute('data-pid');

            card.addEventListener('dragstart', e => {
                if (e.target.closest('input, button, .selfpay-delegate-popover')) {
                    e.preventDefault();
                    return;
                }
                currentState.draggingId = pid;
                card.classList.add('is-dragging');
                if (e.dataTransfer) {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', pid);
                }
            });

            card.addEventListener('dragend', () => {
                currentState.draggingId = null;
                card.classList.remove('is-dragging');
                grid.querySelectorAll('.is-drop-target').forEach(el => el.classList.remove('is-drop-target'));
            });

            card.addEventListener('dragover', e => {
                const srcId = currentState.draggingId;
                if (!srcId || srcId === pid) return;
                e.preventDefault();
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                card.classList.add('is-drop-target');
            });

            card.addEventListener('dragleave', () => {
                card.classList.remove('is-drop-target');
            });

            card.addEventListener('drop', e => {
                e.preventDefault();
                card.classList.remove('is-drop-target');
                const srcId = currentState.draggingId || (e.dataTransfer && e.dataTransfer.getData('text/plain'));
                currentState.draggingId = null;
                if (srcId && srcId !== pid) {
                    mergeParticipantInto(srcId, pid);
                }
            });

            // 7. 모바일 터치 꾹 눌러 드래그 & 드롭 합체 (280ms 롱프레스)
            let longPressTimer = null;
            let touchDragActive = false;
            let touchGhost = null;
            let touchTargetPid = null;
            let startX = 0;
            let startY = 0;

            const cleanupTouchDrag = () => {
                if (longPressTimer) {
                    clearTimeout(longPressTimer);
                    longPressTimer = null;
                }
                if (touchGhost) {
                    touchGhost.remove();
                    touchGhost = null;
                }
                card.classList.remove('is-dragging');
                grid.querySelectorAll('.is-drop-target').forEach(el => el.classList.remove('is-drop-target'));
                currentState.draggingId = null;
                touchDragActive = false;
                touchTargetPid = null;
            };

            card.addEventListener('touchstart', e => {
                if (currentState.isSpinning) return;
                if (card.classList.contains('is-exempt')) return;
                if (e.target.closest('input, button, .selfpay-delegate-popover')) return;
                if (!e.touches || e.touches.length !== 1) return;

                const touch = e.touches[0];
                startX = touch.clientX;
                startY = touch.clientY;
                touchTargetPid = null;

                longPressTimer = setTimeout(() => {
                    touchDragActive = true;
                    currentState.draggingId = pid;
                    card.classList.add('is-dragging');
                    if (navigator.vibrate) {
                        try { navigator.vibrate(25); } catch (_) {}
                    }
                    const rect = card.getBoundingClientRect();
                    touchGhost = card.cloneNode(true);
                    touchGhost.className = 'selfpay-person-card selfpay-touch-ghost';
                    touchGhost.style.width = `${Math.min(rect.width, 210)}px`;
                    touchGhost.style.left = `${startX - Math.min(rect.width, 210) / 2}px`;
                    touchGhost.style.top = `${startY - 38}px`;
                    document.body.appendChild(touchGhost);
                }, 280);
            }, { passive: true });

            card.addEventListener('touchmove', e => {
                const touch = e.touches && e.touches[0];
                if (!touch) return;
                if (!touchDragActive) {
                    if (longPressTimer && Math.hypot(touch.clientX - startX, touch.clientY - startY) > 10) {
                        clearTimeout(longPressTimer);
                        longPressTimer = null;
                    }
                    return;
                }
                e.preventDefault();
                if (touchGhost) {
                    const gw = touchGhost.offsetWidth || 180;
                    touchGhost.style.left = `${touch.clientX - gw / 2}px`;
                    touchGhost.style.top = `${touch.clientY - 38}px`;
                }
                const underEl = document.elementFromPoint(touch.clientX, touch.clientY);
                const overCard = underEl && underEl.closest ? underEl.closest('.selfpay-person-card[data-pid]') : null;
                const overPid = overCard ? overCard.getAttribute('data-pid') : null;
                touchTargetPid = (overPid && overPid !== pid) ? overPid : null;

                grid.querySelectorAll('.selfpay-person-card').forEach(c => {
                    c.classList.toggle('is-drop-target', c.getAttribute('data-pid') === touchTargetPid);
                });
            }, { passive: false });

            card.addEventListener('touchend', e => {
                const wasActive = touchDragActive;
                const targetPid = touchTargetPid;
                cleanupTouchDrag();
                if (wasActive) {
                    e.preventDefault();
                    if (targetPid && targetPid !== pid) {
                        mergeParticipantInto(pid, targetPid);
                    }
                }
            });

            card.addEventListener('touchcancel', cleanupTouchDrag);
        });
    }

    function openSelfPaySplitterModal(entry) {
        if (!entry || typeof entry !== 'object') return;
        const modal = ensureModalDom();

        const clubName = entry.clubName || '기본 클럽';
        const dateText = entry.settlementDate || (entry.date ? String(entry.date).slice(0, 10) : '-');
        const totalSelfPay = Math.max(0, Math.round(Number(entry.totalSelfPay) || 0));

        const rawAttendees = Array.isArray(entry.attendees) ? entry.attendees : [];
        let participants = [];
        if (rawAttendees.length > 0) {
            participants = rawAttendees.map((att, idx) => ({
                id: String(att.id || att.employeeId || `p-${idx}`),
                color: PERSON_PALETTE[idx % PERSON_PALETTE.length],
                name: String((typeof att === 'object' ? att.name : att) || `참석자 ${idx + 1}`).trim(),
                employeeId: String((typeof att === 'object' ? att.employeeId : '') || '').trim(),
                exempt: false,
                paidBy: null,
                manualAmount: null,
                rouletteTag: null,
                isRouletteLocked: false
            }));
        } else {
            const count = Math.max(1, Number(entry.memberCount) || 1);
            for (let i = 0; i < count; i++) {
                participants.push({
                    id: `p-${i + 1}`,
                    color: PERSON_PALETTE[i % PERSON_PALETTE.length],
                    name: `참석자 ${i + 1}`,
                    employeeId: '',
                    exempt: false,
                    paidBy: null,
                    manualAmount: null,
                    rouletteTag: null,
                    isRouletteLocked: false
                });
            }
        }

        const seenIds = new Set();
        participants.forEach((p, idx) => {
            if (seenIds.has(p.id)) p.id = `${p.id}_${idx}`;
            seenIds.add(p.id);
        });

        currentState = {
            clubName,
            settlementDate: dateText,
            totalSelfPay,
            originalSelfPay: totalSelfPay,
            participants,
            draggingId: null,
            pulseIds: new Set(),
            exemptPulseId: null,
            winnerPulseId: null,
            openDelegateId: null,
            isSpinning: false,
            prevAmounts: new Map()
        };

        const subEl = document.getElementById('selfpay-splitter-subtitle');
        if (subEl) {
            subEl.textContent = `${clubName} · ${dateText} · 참석 ${participants.length}명`;
        }

        renderSplitter();
        modal.classList.remove('hidden');
    }

    function closeSelfPaySplitterModal() {
        const modal = document.getElementById('selfpay-splitter-modal');
        if (modal) modal.classList.add('hidden');
        currentState.openDelegateId = null;
        currentState.isSpinning = false;
    }

    window.openSelfPaySplitterModal = openSelfPaySplitterModal;
    window.closeSelfPaySplitterModal = closeSelfPaySplitterModal;
})();
