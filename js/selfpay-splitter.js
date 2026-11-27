// ============================================================
// js/selfpay-splitter.js — 인터랙티브 자부담 계산 툴 (자부담 정산기)
// ============================================================
// v1.7.88: 정산 이력의 자부담 비용 클릭 시 팝업 오픈
//   - 참석자 자동 1/N 분배
//   - 특정 인원 면제 토글 (🎟️ 무임승차권)
//   - 드래그 & 드롭 대신 내주기 합체 (2번 -> 1번 드래그 시 1번이 2인분 자동 부담)
//   - 특정 인원 금액 직접 수정 시 남은 잔여금 나머지 인원 자동 분배
//   - 미니 게임: 자투리 몰아주기 룰렛 / 골든벨 몰빵 룰렛

(function () {
    'use strict';

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
                name: String(p.name || `참석자 ${idx + 1}`).trim(),
                employeeId: String(p.employeeId || '').trim(),
                exempt: Boolean(p.exempt),
                paidBy: p.paidBy ? String(p.paidBy) : null,
                manualAmount: (p.manualAmount !== null && p.manualAmount !== undefined && p.manualAmount !== '' && Number.isFinite(Number(p.manualAmount)))
                    ? Math.max(0, Math.round(Number(p.manualAmount)))
                    : null,
                rouletteTag: p.rouletteTag || null
            })) : [];

            const map = new Map(list.map(p => [p.id, p]));

            // 유효하지 않은 paidBy 정리
            list.forEach(p => {
                if (p.exempt) {
                    p.paidBy = null;
                    p.manualAmount = null;
                    return;
                }
                if (p.paidBy) {
                    const rootId = resolveRootPayer(map, p.paidBy);
                    if (!rootId || rootId === p.id) {
                        p.paidBy = null;
                    } else {
                        p.paidBy = rootId;
                        p.manualAmount = null;
                    }
                }
            });

            // 각 루트 결제자가 대신 내주는 인원 집계
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
                p.coveredMembers = covered.map(c => ({ id: c.id, index: c.index, name: c.name }));
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

            // 나눗셈 자투리(1~N원)는 마지막 자동 분배 인원에게 보정해 합계를 정확히 맞춘다.
            const remainder = remainingPool - distributedAuto;
            if (remainder > 0 && autoRoots.length > 0) {
                autoRoots[autoRoots.length - 1].finalAmount += remainder;
            }

            const activeParticipantCount = list.filter(p => !p.exempt).length;
            const equalReference = activeParticipantCount > 0 ? Math.round(total / activeParticipantCount) : 0;

            return {
                totalSelfPay: total,
                manualSum,
                remainingPool,
                overAllocated,
                totalAutoShares,
                perShare: totalAutoShares > 0 ? Math.round(remainingPool / totalAutoShares) : 0,
                equalReference,
                items: list
            };
        }
    });

    window.SelfPaySplitterEngine = SelfPaySplitterEngine;

    // ── 모달 상태 및 UI 컨트롤러 ─────────────────────────────────
    let currentState = {
        clubName: '',
        settlementDate: '',
        totalSelfPay: 0,
        originalSelfPay: 0,
        participants: [],
        draggingId: null,
        justMergedId: null,
        isSpinning: false
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
                <div class="card-header selfpay-splitter-header">
                    <span class="card-icon">🎮</span>
                    <div class="selfpay-splitter-title-wrap">
                        <h2 id="selfpay-splitter-title">자부담 더치페이 정산기</h2>
                        <small id="selfpay-splitter-subtitle" class="selfpay-splitter-subtitle"></small>
                    </div>
                    <button type="button" id="close-selfpay-splitter-modal" class="attendance-roster-close" aria-label="자부담 정산기 닫기">&times;</button>
                </div>
                <div class="card-body selfpay-splitter-body">
                    <div class="selfpay-dashboard-bar">
                        <div class="selfpay-stat-box">
                            <span class="selfpay-stat-label">총 자부담 금액</span>
                            <div class="selfpay-total-edit-wrap">
                                <input type="text" inputmode="numeric" id="selfpay-total-input" class="selfpay-total-input" aria-label="총 자부담 금액">
                                <span class="selfpay-unit">원</span>
                            </div>
                        </div>
                        <div class="selfpay-stat-box">
                            <span class="selfpay-stat-label">기본 1인분 (자동 분배)</span>
                            <strong id="selfpay-per-share-val" class="selfpay-stat-val">0원</strong>
                        </div>
                        <div class="selfpay-stat-box">
                            <span class="selfpay-stat-label">분배 상태</span>
                            <strong id="selfpay-balance-status" class="selfpay-stat-status">✅ 딱 맞게 분배됨</strong>
                        </div>
                    </div>

                    <div class="selfpay-action-toolbar">
                        <div class="selfpay-guide-pill">
                            💡 <strong>드래그 & 합체:</strong> 2번 사람을 1번 사람 카드로 끌어다 놓으면 1번이 <strong>2인분</strong>을 대신 내줍니다! 금액을 직접 고치면 나머지가 자동 분배됩니다.
                        </div>
                        <div class="selfpay-game-btns">
                            <button type="button" id="selfpay-roulette-change-btn" class="btn-secondary selfpay-game-btn" title="전원 1,000원 단위로 깔끔하게 맞추고 자투리 금액을 룰렛 당첨자 1명에게 몰아줍니다">🎲 1,000원 자투리 룰렛</button>
                            <button type="button" id="selfpay-roulette-allin-btn" class="btn-secondary selfpay-game-btn" title="면제자를 제외한 인원 중 1명을 추첨해 오늘의 골든벨 주인공으로 뽑습니다">🎰 골든벨 1명 뽑기</button>
                            <button type="button" id="selfpay-reset-all-btn" class="btn-secondary selfpay-game-btn">↺ 1/N 초기화</button>
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
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
                closeSelfPaySplitterModal();
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
            currentState.participants.forEach(p => {
                p.exempt = false;
                p.paidBy = null;
                p.manualAmount = null;
                p.rouletteTag = null;
            });
            renderSplitter();
        });

        document.getElementById('selfpay-roulette-change-btn')?.addEventListener('click', () => runRoulette('change'));
        document.getElementById('selfpay-roulette-allin-btn')?.addEventListener('click', () => runRoulette('allin'));

        return modal;
    }

    function runRoulette(mode) {
        if (currentState.isSpinning) return;
        // 면제되지 않은 인원만 대상
        const candidates = currentState.participants.filter(p => !p.exempt);
        if (candidates.length < 2 || currentState.totalSelfPay <= 0) return;

        // 합체/수동 고정 초기화 후 룰렛 시작
        currentState.participants.forEach(p => {
            p.paidBy = null;
            p.manualAmount = null;
            p.rouletteTag = null;
        });
        renderSplitter();

        currentState.isSpinning = true;
        const grid = document.getElementById('selfpay-cards-grid');
        const totalSteps = 14 + Math.floor(Math.random() * candidates.length);
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
                setTimeout(tick, 55 + step * 12);
            } else {
                currentState.isSpinning = false;
                const winner = candidates[winnerIdx];
                if (mode === 'allin') {
                    candidates.forEach(p => {
                        if (p.id === winner.id) {
                            p.manualAmount = currentState.totalSelfPay;
                            p.rouletteTag = '🎯 골든벨 당첨!';
                        } else {
                            p.manualAmount = 0;
                        }
                    });
                } else {
                    // 1,000원 단위 깔끔 정산 + 자투리 당첨자 몰아주기
                    const baseUnit = Math.floor((currentState.totalSelfPay / candidates.length) / 1000) * 1000;
                    const remainder = currentState.totalSelfPay - (baseUnit * candidates.length);
                    candidates.forEach(p => {
                        if (p.id === winner.id) {
                            p.manualAmount = baseUnit + remainder;
                            p.rouletteTag = remainder > 0 ? `🎲 자투리 +${fmtNum(remainder)}원 당첨!` : '🎲 당첨!';
                        } else {
                            p.manualAmount = baseUnit;
                        }
                    });
                }
                currentState.justMergedId = winner.id;
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
            return `<span class="selfpay-role-badge badge-exempt">🎟️ 무임승차권 (면제)</span>`;
        }
        if (item.role === 'covered') {
            return `<span class="selfpay-role-badge badge-covered">🙌 ${item.paidByIndex}번 ${escapeHtml(item.paidByName)}님이 대신 결제</span>`;
        }
        if (item.shareCount >= 3) {
            return `<span class="selfpay-role-badge badge-hero">💸 골든벨! (${item.shareCount}명분 합산)</span>`;
        }
        if (item.shareCount === 2) {
            return `<span class="selfpay-role-badge badge-angel">👼 천사 등장 (2명분 합산)</span>`;
        }
        if (item.manualAmount !== null) {
            if (item.finalAmount > equalRef) {
                return `<span class="selfpay-role-badge badge-generous">🎩 통 큰 쾌척! (고정)</span>`;
            }
            return `<span class="selfpay-role-badge badge-locked">🔒 금액 고정</span>`;
        }
        return `<span class="selfpay-role-badge badge-normal">⚖️ 기본 1인분</span>`;
    }

    function mergeParticipantInto(sourceId, targetId) {
        if (!sourceId || !targetId || sourceId === targetId) return;
        const src = currentState.participants.find(p => p.id === sourceId);
        const tgt = currentState.participants.find(p => p.id === targetId);
        if (!src || !tgt) return;

        // 타겟이 다른 사람에게 종속되어 있으면 그 루트로 보낸다.
        const actualTargetId = (!tgt.exempt && tgt.paidBy) ? tgt.paidBy : tgt.id;
        if (actualTargetId === src.id) return;
        const actualTarget = currentState.participants.find(p => p.id === actualTargetId);
        if (!actualTarget) return;

        // 타겟은 활성 결제자로 전환하고 수동 고정 금액을 해제해 자동으로 N명분이 계산되도록 함
        actualTarget.exempt = false;
        actualTarget.paidBy = null;
        actualTarget.manualAmount = null;
        actualTarget.rouletteTag = null;

        // 만약 src가 이미 다른 사람들을 품고 있었다면 함께 actualTarget으로 이동
        currentState.participants.forEach(p => {
            if (p.paidBy === src.id) {
                p.paidBy = actualTarget.id;
            }
        });

        src.exempt = false;
        src.paidBy = actualTarget.id;
        src.manualAmount = null;
        src.rouletteTag = null;

        currentState.justMergedId = actualTarget.id;
        renderSplitter();
    }

    function renderSplitter() {
        const computed = SelfPaySplitterEngine.compute(currentState.totalSelfPay, currentState.participants);

        const totalInput = document.getElementById('selfpay-total-input');
        if (totalInput && document.activeElement !== totalInput) {
            totalInput.value = fmtNum(computed.totalSelfPay);
        }

        const perShareEl = document.getElementById('selfpay-per-share-val');
        if (perShareEl) {
            perShareEl.textContent = `${fmtNum(computed.perShare)}원`;
        }

        const statusEl = document.getElementById('selfpay-balance-status');
        if (statusEl) {
            const allocatedSum = computed.items.reduce((s, it) => s + (it.finalAmount || 0), 0);
            if (computed.overAllocated > 0) {
                statusEl.textContent = `⚠️ 총액 ${fmtNum(computed.overAllocated)}원 초과`;
                statusEl.style.color = '#ef4444';
            } else if (allocatedSum !== computed.totalSelfPay && computed.totalSelfPay > 0) {
                statusEl.textContent = `⚠️ 미배정 ${fmtNum(computed.totalSelfPay - allocatedSum)}원 (전원 면제/고정)`;
                statusEl.style.color = '#f59e0b';
            } else {
                statusEl.textContent = `✅ 총 ${fmtNum(allocatedSum)}원 분배 완료`;
                statusEl.style.color = 'var(--color-secondary)';
            }
        }

        const grid = document.getElementById('selfpay-cards-grid');
        if (!grid) return;

        const activePayers = computed.items.filter(it => it.role === 'payer');

        grid.innerHTML = computed.items.map(item => {
            const isPayer = item.role === 'payer';
            const isExempt = item.role === 'exempt';
            const isCovered = item.role === 'covered';
            const isMergedHighlight = currentState.justMergedId === item.id;
            const cardClasses = [
                'selfpay-person-card',
                isExempt ? 'is-exempt' : '',
                isCovered ? 'is-covered' : '',
                item.shareCount >= 2 ? 'is-multi-payer' : '',
                item.manualAmount !== null ? 'is-manual-locked' : '',
                isMergedHighlight ? 'just-merged' : ''
            ].filter(Boolean).join(' ');

            const coveredChipsHtml = item.coveredMembers.length > 0
                ? `<div class="selfpay-covered-chips">
                    ${item.coveredMembers.map(cm => `
                        <span class="selfpay-covered-chip" title="클릭하면 대신 내주기를 해제합니다">
                            🤝 ${cm.index}번 ${escapeHtml(cm.name)} 몫 포함
                            <button type="button" class="selfpay-unmerge-chip-btn" data-unmerge-id="${escapeHtml(cm.id)}" aria-label="${escapeHtml(cm.name)} 분리">&times;</button>
                        </span>
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
                        <small>${isExempt ? '자부담 면제됨' : `${item.paidByIndex}번 ${escapeHtml(item.paidByName)}님에게 합산됨`}</small>
                   </div>`;

            // 모바일/클릭용 대신 내주기 드롭다운
            const otherPayers = activePayers.filter(p => p.id !== item.id);
            const delegateSelectHtml = (isPayer && otherPayers.length > 0)
                ? `<select class="selfpay-delegate-select" data-source-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.name)} 대신 내줄 사람 선택">
                        <option value="">🤝 대신 내주기...</option>
                        ${otherPayers.map(op => `<option value="${escapeHtml(op.id)}">→ ${op.index}번 ${escapeHtml(op.name)}에게 넘기기</option>`).join('')}
                   </select>`
                : '';

            return `
                <div class="${cardClasses}" data-pid="${escapeHtml(item.id)}" draggable="${!isExempt}">
                    <div class="selfpay-card-top">
                        <div class="selfpay-person-identity">
                            <span class="selfpay-person-num">${item.index}</span>
                            <strong class="selfpay-person-name">${escapeHtml(item.name)}</strong>
                            ${item.employeeId ? `<small class="selfpay-person-empid">(${escapeHtml(item.employeeId)})</small>` : ''}
                        </div>
                        ${getRoleBadgeHtml(item, computed.equalReference)}
                    </div>

                    ${coveredChipsHtml}
                    ${amountSectionHtml}

                    <div class="selfpay-card-actions">
                        <button type="button" class="selfpay-exempt-btn ${isExempt ? 'is-active' : ''}" data-exempt-id="${escapeHtml(item.id)}">
                            ${isExempt ? '↩ 면제 해제' : '🛡️ 면제'}
                        </button>
                        ${isCovered
                            ? `<button type="button" class="selfpay-separate-btn" data-unmerge-id="${escapeHtml(item.id)}">↩ 본인 부담으로 분리</button>`
                            : delegateSelectHtml}
                    </div>
                </div>
            `;
        }).join('');

        currentState.justMergedId = null;
        bindCardEvents(grid);
    }

    function bindCardEvents(grid) {
        // 1. 면제 토글
        grid.querySelectorAll('[data-exempt-id]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const pid = btn.getAttribute('data-exempt-id');
                const target = currentState.participants.find(p => p.id === pid);
                if (!target) return;
                target.exempt = !target.exempt;
                target.paidBy = null;
                target.manualAmount = null;
                target.rouletteTag = null;
                if (target.exempt) {
                    // 이 사람이 대신 내주던 사람들도 독립 상태로 풀어준다.
                    currentState.participants.forEach(p => {
                        if (p.paidBy === target.id) p.paidBy = null;
                    });
                }
                renderSplitter();
            });
        });

        // 2. 대신 내주기 분리(해제)
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

        // 3. 드롭다운으로 대신 내주기 넘기기 (모바일 및 클릭 편의)
        grid.querySelectorAll('.selfpay-delegate-select').forEach(sel => {
            sel.addEventListener('change', e => {
                e.stopPropagation();
                const srcId = sel.getAttribute('data-source-id');
                const tgtId = sel.value;
                if (srcId && tgtId) {
                    mergeParticipantInto(srcId, tgtId);
                }
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
                target.manualAmount = parseNum(input.value);
                target.rouletteTag = null;
                renderSplitter();
            });
        });

        // 5. 수동 고정 해제 -> 자동 분배 복귀
        grid.querySelectorAll('[data-unlock-id]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const pid = btn.getAttribute('data-unlock-id');
                const target = currentState.participants.find(p => p.id === pid);
                if (!target) return;
                target.manualAmount = null;
                target.rouletteTag = null;
                renderSplitter();
            });
        });

        // 6. 드래그 & 드롭 대신 내주기 합체 (2번을 드래그해서 1번에게 드롭 -> 1번이 2인분 자동 표시)
        grid.querySelectorAll('.selfpay-person-card').forEach(card => {
            const pid = card.getAttribute('data-pid');

            card.addEventListener('dragstart', e => {
                if (e.target.closest('input, select, button')) {
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
                name: String((typeof att === 'object' ? att.name : att) || `참석자 ${idx + 1}`).trim(),
                employeeId: String((typeof att === 'object' ? att.employeeId : '') || '').trim(),
                exempt: false,
                paidBy: null,
                manualAmount: null,
                rouletteTag: null
            }));
        } else {
            const count = Math.max(1, Number(entry.memberCount) || 1);
            for (let i = 0; i < count; i++) {
                participants.push({
                    id: `p-${i + 1}`,
                    name: `참석자 ${i + 1}`,
                    employeeId: '',
                    exempt: false,
                    paidBy: null,
                    manualAmount: null,
                    rouletteTag: null
                });
            }
        }

        // 중복 ID 방지
        const seenIds = new Set();
        participants.forEach((p, idx) => {
            if (seenIds.has(p.id)) {
                p.id = `${p.id}_${idx}`;
            }
            seenIds.add(p.id);
        });

        currentState = {
            clubName,
            settlementDate: dateText,
            totalSelfPay,
            originalSelfPay: totalSelfPay,
            participants,
            draggingId: null,
            justMergedId: null,
            isSpinning: false
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
        currentState.isSpinning = false;
    }

    window.openSelfPaySplitterModal = openSelfPaySplitterModal;
    window.closeSelfPaySplitterModal = closeSelfPaySplitterModal;
})();
