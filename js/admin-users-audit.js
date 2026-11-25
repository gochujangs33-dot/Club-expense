// ============================================================
// js/admin-users-audit.js — 관리자 계정·권한·작업 로그·피드백 관리 모듈
// ============================================================
// v1.7.67: app.js 에서 분리
//   - 감사 로그(작업 로그) 조회·필터링·상세 펼침·모달 제어
//   - 가입 회원 권한 변경·정보 수정·삭제
//   - 요청사항(피드백) 목록 렌더링·확인 완료·삭제

window.__installAdminUsersAudit = function (B) {
    // ── 관리자 감사 로그 ────────────────────────────────────────────────
    const AUDIT_LOG_PAGE_SIZE = 200;
    let auditLogEntries = [];
    let auditLogOldestKey = null;
    let auditLogHasMore = true;
    let auditLogLoading = false;

    function getAuditLogDateParts(timestamp) {
        const date = new Date(Number(timestamp) || 0);
        if (!Number.isFinite(date.getTime())) return { date: '-', time: '-' };
        const pad = value => String(value).padStart(2, '0');
        return {
            date: `${date.getFullYear()}년 ${pad(date.getMonth() + 1)}월 ${pad(date.getDate())}일`,
            time: `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
        };
    }

    function getAuditActionGroup(action) {
        const normalized = String(action || 'UPDATE').trim().toUpperCase();
        if (['CREATE', 'INPUT', 'INSERT', 'SAVE'].includes(normalized)) return 'CREATE';
        if (['DELETE', 'REMOVE'].includes(normalized)) return 'DELETE';
        return 'UPDATE';
    }

    function isLoginAuditEntry(entry) {
        return AppState.isExcludedAuditEvent ? AppState.isExcludedAuditEvent(entry) : AppState.isLoginAuditEvent(entry);
    }

    function formatAuditDetailValue(value, key = '') {
        if (value === true) return '예';
        if (value === false) return '아니요';
        if (value === null || value === undefined || value === '') return '-';
        if (typeof value === 'number' && Number.isFinite(value)
            && /(금액|예산|지원금|잔여|누적)/.test(String(key))) {
            return SettlementCalculator.formatCurrency(value);
        }
        return String(value);
    }

    function bindAuditLogItemDetails(listEl) {
        listEl.querySelectorAll('.audit-log-item').forEach(item => {
            const toggle = () => {
                const detail = item.querySelector('.audit-log-expanded-detail');
                const expanded = item.getAttribute('aria-expanded') === 'true';
                item.setAttribute('aria-expanded', String(!expanded));
                item.classList.toggle('expanded', !expanded);
                if (detail) detail.hidden = expanded;
            };
            item.addEventListener('click', toggle);
            item.addEventListener('keydown', event => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                toggle();
            });
        });
    }

    function renderAuditLogList() {
        const listEl = document.getElementById('audit-log-list');
        const countEl = document.getElementById('audit-log-count');
        const loadMoreBtn = document.getElementById('audit-log-load-more-btn');
        if (!listEl || !countEl) return;

        const month = document.getElementById('audit-log-month-filter')?.value || '';
        const action = document.getElementById('audit-log-action-filter')?.value || '';
        const typeFilter = document.getElementById('audit-log-type-filter')?.value || '';
        const keyword = (document.getElementById('audit-log-search-input')?.value || '').trim().toLowerCase();
        const visibleEntries = auditLogEntries.filter(entry => !isLoginAuditEntry(entry));
        const filtered = visibleEntries.filter(entry => {
            const timestamp = Number(entry.timestamp || entry.clientTimestamp || 0);
            if (month) {
                const date = new Date(timestamp);
                const entryMonth = Number.isFinite(date.getTime())
                    ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
                    : '';
                if (entryMonth !== month) return false;
            }
            if (action && getAuditActionGroup(entry.action) !== action) return false;
            if (typeFilter) {
                const typeText = `${entry.targetType || ''} ${entry.summary || ''}`.toLowerCase();
                if (typeFilter === 'SETTLEMENT') {
                    if (!typeText.includes('정산')) return false;
                } else if (typeFilter === 'BUDGET_ADD') {
                    if (!typeText.includes('추가 배정') && !typeText.includes('추가배정')) return false;
                } else if (typeFilter === 'APPROVAL_85K') {
                    if (!typeText.includes('85') && !typeText.includes('초과 지원 승인')) return false;
                } else if (typeFilter === 'CLUB') {
                    if ((!typeText.includes('클럽') && !typeText.includes('예산')) || typeText.includes('추가 배정') || typeText.includes('추가배정') || typeText.includes('85') || typeText.includes('초과 지원 승인')) return false;
                } else if (typeFilter === 'USER') {
                    if (!typeText.includes('회원') && !typeText.includes('가입')) return false;
                } else if (typeFilter === 'RULES') {
                    if (!typeText.includes('정산 구간') && !typeText.includes('정산 기준') && !typeText.includes('규칙') && !typeText.includes('한도')) return false;
                } else if (typeFilter === 'DIRECTORY') {
                    if (!typeText.includes('명부')) return false;
                }
            }
            if (keyword) {
                const haystack = [entry.actorName, entry.actorPin, entry.actorRole, entry.targetType,
                    entry.targetLabel, entry.summary, entry.clubName, ...Object.values(entry.details || {})]
                    .join(' ').toLowerCase();
                if (!haystack.includes(keyword)) return false;
            }
            return true;
        });

        countEl.textContent = `표시 ${filtered.length}건 · 불러온 작업 기록 ${visibleEntries.length}건`;
        if (filtered.length === 0) {
            listEl.innerHTML = `<div class="empty-state"><span class="empty-icon">📜</span><p>${auditLogEntries.length ? '조건에 맞는 로그 기록이 없습니다.' : '아직 저장된 로그 기록이 없습니다.'}</p></div>`;
        } else {
            const actionText = { CREATE: '입력·추가', UPDATE: '수정·업데이트', DELETE: '삭제' };
            listEl.innerHTML = filtered.map(entry => {
                const dateParts = getAuditLogDateParts(entry.timestamp || entry.clientTimestamp);
                const detailPairs = Object.entries(entry.details || {});
                const detailsHtml = detailPairs.length
                    ? `<dl>${detailPairs.map(([key, value]) => `<dt>${AppState.escapeHtml(key)}</dt><dd>${AppState.escapeHtml(formatAuditDetailValue(value, key))}</dd>`).join('')}</dl>`
                    : '<p class="audit-log-no-detail">별도로 저장된 변경값이 없습니다.</p>';
                const actionGroup = getAuditActionGroup(entry.action);
                const actionClass = actionGroup.toLowerCase();
                return `
                    <article class="audit-log-item" data-log-key="${AppState.escapeHtml(entry.key || '')}" role="button" tabindex="0" aria-expanded="false">
                        <div class="audit-log-item-summary">
                            <time class="audit-log-time"><strong>${AppState.escapeHtml(dateParts.date)}</strong><small>${AppState.escapeHtml(dateParts.time)}</small></time>
                            <div class="audit-log-actor"><strong>${AppState.escapeHtml(entry.actorName || '알 수 없음')}</strong><small>${AppState.escapeHtml(entry.actorRole || '')} · PIN ${AppState.escapeHtml(entry.actorPin || '-')}</small></div>
                            <div class="audit-log-action"><span class="audit-log-action-badge ${actionClass}">${AppState.escapeHtml(actionText[actionGroup])}</span></div>
                            <div class="audit-log-target">
                                <strong>${AppState.escapeHtml(entry.summary || entry.targetLabel || '-')}</strong>
                                <small>${AppState.escapeHtml(entry.targetType || '기타')}${entry.clubName ? ` · ${AppState.escapeHtml(entry.clubName)}` : ''}</small>
                            </div>
                            <span class="audit-log-expand-icon" aria-hidden="true">⌄</span>
                        </div>
                        <div class="audit-log-expanded-detail" hidden>
                            <div class="audit-log-detail-context">
                                <span><b>작업자</b>${AppState.escapeHtml(entry.actorName || '알 수 없음')} · ${AppState.escapeHtml(entry.actorRole || '')} · PIN ${AppState.escapeHtml(entry.actorPin || '-')}</span>
                                <span><b>작업 시각</b>${AppState.escapeHtml(dateParts.date)} ${AppState.escapeHtml(dateParts.time)}</span>
                                <span><b>대상</b>${AppState.escapeHtml(entry.targetType || '기타')}${entry.targetLabel ? ` · ${AppState.escapeHtml(entry.targetLabel)}` : ''}${entry.clubName ? ` · ${AppState.escapeHtml(entry.clubName)}` : ''}</span>
                            </div>
                            <div class="audit-log-details">
                                <h3>상세 변경 내용</h3>
                                ${detailsHtml}
                            </div>
                        </div>
                    </article>`;
            }).join('');
            bindAuditLogItemDetails(listEl);
        }
        if (loadMoreBtn) loadMoreBtn.classList.toggle('hidden', !auditLogHasMore || auditLogLoading);
    }

    async function loadAuditLogs({ reset = false } = {}) {
        const firebaseDb = B.firebaseDb;
        if (!AppState.hasAdminAccess || !firebaseDb || auditLogLoading) return;
        const statusEl = document.getElementById('audit-log-load-status');
        const loadMoreBtn = document.getElementById('audit-log-load-more-btn');
        auditLogLoading = true;
        if (reset) {
            auditLogEntries = [];
            auditLogOldestKey = null;
            auditLogHasMore = true;
        }
        if (statusEl) statusEl.textContent = '로그를 불러오는 중...';
        if (loadMoreBtn) loadMoreBtn.classList.add('hidden');
        try {
            const pageLimit = auditLogOldestKey ? AUDIT_LOG_PAGE_SIZE + 1 : AUDIT_LOG_PAGE_SIZE;
            let query = firebaseDb.ref('auditLogs').orderByKey();
            if (auditLogOldestKey) query = query.endAt(auditLogOldestKey);
            const snapshot = await query.limitToLast(pageLimit).once('value');
            const page = [];
            snapshot.forEach(child => {
                page.push({ key: child.key, ...(child.val() || {}) });
            });
            if (auditLogOldestKey && page.length && page[page.length - 1]?.key === auditLogOldestKey) {
                page.pop();
            } else if (auditLogOldestKey) {
                const duplicateIndex = page.findIndex(entry => entry.key === auditLogOldestKey);
                if (duplicateIndex >= 0) page.splice(duplicateIndex, 1);
            }
            const byKey = new Map(auditLogEntries.map(entry => [entry.key, entry]));
            page.forEach(entry => byKey.set(entry.key, entry));
            auditLogEntries = [...byKey.values()].sort((a, b) => String(b.key).localeCompare(String(a.key)));
            auditLogOldestKey = auditLogEntries.length ? auditLogEntries[auditLogEntries.length - 1].key : null;
            auditLogHasMore = page.length >= AUDIT_LOG_PAGE_SIZE;
            if (statusEl) statusEl.textContent = auditLogHasMore ? '이전 기록을 더 불러올 수 있습니다.' : '가장 오래된 기록까지 불러왔습니다.';
        } catch (err) {
            console.error('감사 로그 조회 실패:', err);
            if (statusEl) statusEl.textContent = '로그 조회에 실패했습니다. 네트워크를 확인해 주세요.';
        } finally {
            auditLogLoading = false;
            renderAuditLogList();
        }
    }

    function openAuditLogModal() {
        if (!AppState.hasAdminAccess) return;
        const modal = document.getElementById('audit-log-modal');
        if (!modal) return;
        modal.classList.remove('hidden');
        auditLogLoading = false;
        loadAuditLogs({ reset: true });
    }

    function closeAuditLogModal() {
        const modal = document.getElementById('audit-log-modal');
        if (modal) modal.classList.add('hidden');
    }
    window.openAuditLogModal = openAuditLogModal;
    window.closeAuditLogModal = closeAuditLogModal;

    document.getElementById('admin-audit-log-btn')?.addEventListener('click', openAuditLogModal);
    document.getElementById('close-audit-log-modal')?.addEventListener('click', closeAuditLogModal);
    document.getElementById('audit-log-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'audit-log-modal') closeAuditLogModal();
    });

    // ── 가입 회원 - 이름/PIN/권한 수정 및 삭제 ────────────────────────────────
    function getRoleBadgeHtml(role) {
        if (role === 'president') {
            return `<span style="display:inline-flex; align-items:center; gap:0.2rem; padding:0.15rem 0.45rem; font-size:0.72rem; font-weight:700; color:#b45309; background:rgba(245,158,11,0.16); border:1px solid rgba(245,158,11,0.4); border-radius:6px; margin-left:0.35rem;">👑 회장</span>`;
        }
        if (role === 'developer') {
            return `<span style="display:inline-flex; align-items:center; gap:0.2rem; padding:0.15rem 0.45rem; font-size:0.72rem; font-weight:700; color:#0284c7; background:rgba(56,189,248,0.15); border:1px solid rgba(56,189,248,0.38); border-radius:6px; margin-left:0.35rem;">💻 개발자</span>`;
        }
        if (role === 'admin') {
            return `<span style="display:inline-flex; align-items:center; gap:0.2rem; padding:0.15rem 0.45rem; font-size:0.72rem; font-weight:700; color:#059669; background:rgba(16,185,129,0.15); border:1px solid rgba(16,185,129,0.38); border-radius:6px; margin-left:0.35rem;">🛡️ 관리자</span>`;
        }
        return '';
    }

    function changeAdminUserRole(targetPin, targetName, newRole, selectEl) {
        const firebaseDb = B.firebaseDb;
        if (!firebaseDb || !AppState.hasAdminAccess) return;
        const normalizedRole = ['president', 'developer', 'admin', 'member'].includes(newRole) ? newRole : 'member';
        const nextIsAdmin = normalizedRole !== 'member';

        firebaseDb.ref('users').once('value').then(snap => {
            const allUsers = snap.val() || {};
            const targetUser = allUsers[targetPin] || { name: targetName };
            const prevRole = AppState.normalizeUserRole(targetUser, targetPin);
            const prevIsAdmin = AppState.checkHasAdminAccess(targetUser, targetPin);

            if (prevRole === normalizedRole && prevIsAdmin === nextIsAdmin) return;

            if (prevIsAdmin && !nextIsAdmin) {
                const remainingAdmins = Object.keys(allUsers).filter(p => {
                    if (p === '000000' || p === targetPin) return false;
                    return AppState.checkHasAdminAccess(allUsers[p], p);
                });
                if (remainingAdmins.length === 0) {
                    alert('최소 1명 이상의 관리자(회장/개발자/추가 관리자)가 유지되어야 합니다.\n다른 회원에게 먼저 관리자 권한을 부여한 뒤 변경해 주세요.');
                    if (selectEl) selectEl.value = prevRole;
                    return;
                }
            }

            const nowTs = Date.now();
            const updates = {
                [`users/${targetPin}/role`]: normalizedRole,
                [`users/${targetPin}/isAdmin`]: nextIsAdmin,
                [`users/${targetPin}/roleUpdatedAt`]: nowTs
            };

            const prevLabel = AppState.getRoleLabel(prevRole, prevIsAdmin);
            const nextLabel = AppState.getRoleLabel(normalizedRole, nextIsAdmin);
            let displacedNote = '';

            if (normalizedRole === 'president' || normalizedRole === 'developer') {
                Object.keys(allUsers).forEach(otherPin => {
                    if (otherPin === '000000' || otherPin === targetPin) return;
                    const otherRole = AppState.normalizeUserRole(allUsers[otherPin], otherPin);
                    if (otherRole === normalizedRole) {
                        updates[`users/${otherPin}/role`] = 'admin';
                        updates[`users/${otherPin}/isAdmin`] = true;
                        updates[`users/${otherPin}/roleUpdatedAt`] = nowTs;
                        displacedNote = ` (기존 ${nextLabel} '${allUsers[otherPin]?.name || otherPin}'님은 '추가 관리자'로 자동 전환)`;
                    }
                });
            }

            AppState.appendAuditUpdate(updates, {
                action: 'UPDATE',
                targetType: '회원 정보 수정',
                targetId: targetPin,
                targetLabel: `${targetName} (${targetPin})`,
                summary: `회원 권한 변경: '${targetName} (${targetPin})' [${prevLabel} → ${nextLabel}]${displacedNote}`,
                details: {
                    대상회원: `${targetName} (${targetPin})`,
                    이전권한: prevLabel,
                    변경권한: nextLabel,
                    관리자접속가능: nextIsAdmin ? '가능 (상단 관리자 버튼 활성화)' : '불가 (일반 사용자)'
                }
            });

            return firebaseDb.ref().update(updates).then(() => {
                if (typeof B.renderAdminDashboard === 'function') B.renderAdminDashboard();
            });
        }).catch(err => {
            console.error('권한 변경 실패:', err);
            alert('권한 변경 중 오류가 발생했습니다.');
            if (typeof B.renderAdminDashboard === 'function') B.renderAdminDashboard();
        });
    }

    function editAdminUser(oldPin, currentName, currentRole = 'member', currentEmail = '') {
        const firebaseDb = B.firebaseDb;
        const overlay = document.getElementById('edit-user-modal-overlay');
        const nameInput = document.getElementById('edit-user-name-input');
        const pinInput = document.getElementById('edit-user-pin-input');
        const emailPrefixInput = document.getElementById('edit-user-email-prefix-input');
        const roleSelect = document.getElementById('edit-user-role-select');
        const errEl = document.getElementById('edit-user-error');
        const okBtn = document.getElementById('edit-user-modal-ok');
        const cancelBtn = document.getElementById('edit-user-modal-cancel');
        if (!overlay) return;

        nameInput.value = currentName;
        pinInput.value = oldPin;
        let emailTouched = false;
        const onEmailInput = () => { emailTouched = true; };
        if (emailPrefixInput) {
            emailPrefixInput.value = String(currentEmail || '').trim().replace(/@.*$/, '');
            emailPrefixInput.addEventListener('input', onEmailInput);
        }
        if (roleSelect) roleSelect.value = ['president', 'developer', 'admin', 'member'].includes(currentRole) ? currentRole : 'member';
        errEl.style.display = 'none';
        overlay.style.display = 'flex';
        nameInput.focus();

        // users/{pin}/email이 비어있는 기존 회원은 settlements/{pin}/reportEmail에서 자동 조회해 표시 (구 기본값 finance@club.com 제외)
        if (!currentEmail && firebaseDb && oldPin) {
            firebaseDb.ref(`settlements/${oldPin}/reportEmail`).once('value').then(snap => {
                const fallbackEmail = String(snap.val() || '').trim();
                if (!fallbackEmail || fallbackEmail === 'finance@club.com') return;
                if (overlay.style.display === 'flex' && emailPrefixInput && !emailTouched && !emailPrefixInput.value.trim()) {
                    emailPrefixInput.value = fallbackEmail.replace(/@.*$/, '');
                }
                firebaseDb.ref(`users/${oldPin}/email`).set(fallbackEmail).catch(() => {});
            }).catch(() => {});
        }

        const close = () => { overlay.style.display = 'none'; cleanup(); };
        const handleOk = () => {
            const newName = nameInput.value.trim();
            const newPin = pinInput.value.trim();
            const rawEmailPrefix = emailPrefixInput ? emailPrefixInput.value.trim() : '';
            const emailPrefix = rawEmailPrefix.replace(/@.*$/, '').trim();
            const newEmail = emailPrefix ? `${emailPrefix}@mmm.com` : '';
            const newRole = roleSelect ? roleSelect.value : currentRole;
            const nextIsAdmin = newRole !== 'member';
            if (!newName) { errEl.textContent = '이름을 입력해주세요.'; errEl.style.display = 'block'; return; }
            if (!/^\d{6}$/.test(newPin)) { errEl.textContent = t('alert.pin_digit_required'); errEl.style.display = 'block'; return; }
            if (newPin === '000000') { errEl.textContent = '000000은 사용할 수 없는 PIN 번호입니다.'; errEl.style.display = 'block'; return; }
            if (emailPrefix && /\s/.test(emailPrefix)) { errEl.textContent = '이메일 아이디는 공백 없이 입력해주세요.'; errEl.style.display = 'block'; return; }

            firebaseDb.ref('users').once('value').then(allSnap => {
                const allUsers = allSnap.val() || {};
                const userData = { ...(allUsers[oldPin] || {}) };
                const prevEmail = String(userData.email || currentEmail || '');
                const prevRole = AppState.normalizeUserRole(userData, oldPin);
                const prevIsAdmin = AppState.checkHasAdminAccess(userData, oldPin);

                if (prevIsAdmin && !nextIsAdmin) {
                    const remainingAdmins = Object.keys(allUsers).filter(p => {
                        if (p === '000000' || p === oldPin) return false;
                        return AppState.checkHasAdminAccess(allUsers[p], p);
                    });
                    if (remainingAdmins.length === 0) {
                        errEl.textContent = '최소 1명 이상의 관리자가 유지되어야 합니다.';
                        errEl.style.display = 'block';
                        return Promise.reject(new Error('last-admin'));
                    }
                }

                close();
                const nowTs = Date.now();
                userData.name = newName;
                userData.email = newEmail;
                userData.role = newRole;
                userData.isAdmin = nextIsAdmin;
                userData.roleUpdatedAt = nowTs;

                const prevRoleLabel = AppState.getRoleLabel(prevRole, prevIsAdmin);
                const nextRoleLabel = AppState.getRoleLabel(newRole, nextIsAdmin);
                const auditEvent = {
                    action: 'UPDATE',
                    targetType: '회원 정보 수정',
                    targetId: newPin,
                    targetLabel: `${newName} (${newPin})`,
                    summary: `회원 정보 수정: '${currentName} (${oldPin}, ${prevRoleLabel})' → '${newName} (${newPin}, ${nextRoleLabel})'${newEmail && newEmail !== prevEmail ? ` · 이메일: ${newEmail}` : ''}`,
                    details: {
                        이전이름: currentName,
                        변경이름: newName,
                        이전PIN: oldPin,
                        변경PIN: newPin,
                        이전이메일: prevEmail || '-',
                        변경이메일: newEmail || '-',
                        이전권한: prevRoleLabel,
                        변경권한: nextRoleLabel
                    }
                };

                const applyRoleDisplacement = (updatesObj) => {
                    if (newRole === 'president' || newRole === 'developer') {
                        Object.keys(allUsers).forEach(otherPin => {
                            if (otherPin === '000000' || otherPin === oldPin || otherPin === newPin) return;
                            const otherRole = AppState.normalizeUserRole(allUsers[otherPin], otherPin);
                            if (otherRole === newRole) {
                                updatesObj[`users/${otherPin}/role`] = 'admin';
                                updatesObj[`users/${otherPin}/isAdmin`] = true;
                                updatesObj[`users/${otherPin}/roleUpdatedAt`] = nowTs;
                            }
                        });
                    }
                };

                if (newPin === oldPin) {
                    const updates = {
                        [`users/${oldPin}/name`]: userData.name,
                        [`users/${oldPin}/email`]: userData.email,
                        [`users/${oldPin}/role`]: userData.role,
                        [`users/${oldPin}/isAdmin`]: userData.isAdmin,
                        [`users/${oldPin}/roleUpdatedAt`]: nowTs,
                        [`settlements/${oldPin}/reportEmail`]: newEmail
                    };
                    applyRoleDisplacement(updates);
                    AppState.appendAuditUpdate(updates, auditEvent);
                    return firebaseDb.ref().update(updates).then(() => {
                        if (String(AppState.currentPin) === String(oldPin)) {
                            AppState.userName = newName;
                            AppState.reportEmail = newEmail;
                            if (typeof B.setSettingsFormValues === 'function') B.setSettingsFormValues(AppState.rules);
                        }
                    });
                }
                if (allUsers[newPin]) {
                    alert(t('alert.pin_already_used'));
                    return Promise.reject(new Error('duplicate-pin'));
                }
                return firebaseDb.ref(`settlements/${oldPin}`).once('value').then(settlementSnap => {
                    const updates = {
                        [`users/${newPin}`]: userData,
                        [`users/${oldPin}`]: null
                    };
                    applyRoleDisplacement(updates);
                    if (settlementSnap.exists()) {
                        const sVal = { ...(settlementSnap.val() || {}) };
                        if (newEmail) sVal.reportEmail = newEmail;
                        updates[`settlements/${newPin}`] = sVal;
                        updates[`settlements/${oldPin}`] = null;
                    } else if (newEmail) {
                        updates[`settlements/${newPin}/reportEmail`] = newEmail;
                    }
                    AppState.appendAuditUpdate(updates, auditEvent);
                    return firebaseDb.ref().update(updates).then(() => {
                        if (String(AppState.currentPin) === String(oldPin)) {
                            AppState.currentPin = newPin;
                            AppState.userName = newName;
                            if (newEmail) {
                                AppState.reportEmail = newEmail;
                                if (typeof B.setSettingsFormValues === 'function') B.setSettingsFormValues(AppState.rules);
                            }
                            AppState.userRole = newRole;
                            AppState.hasAdminAccess = nextIsAdmin;
                            AppState._bindUserRoleListener(newPin);
                            if (typeof B.syncHeaderAdminButton === 'function') B.syncHeaderAdminButton();
                        }
                    });
                });
            }).then(() => {
                if (typeof B.renderAdminDashboard === 'function') B.renderAdminDashboard();
            }).catch(err => {
                if (err && err.message !== 'duplicate-pin' && err.message !== 'last-admin') {
                    console.error('회원 정보 수정 실패:', err);
                    alert(t('alert.edit_user_failed'));
                }
            });
        };
        const handleCancel = () => close();
        const handleKey = (e) => { if (e.key === 'Enter') handleOk(); if (e.key === 'Escape') handleCancel(); };
        const cleanup = () => {
            okBtn.removeEventListener('click', handleOk);
            cancelBtn.removeEventListener('click', handleCancel);
            overlay.removeEventListener('keydown', handleKey);
            if (emailPrefixInput) emailPrefixInput.removeEventListener('input', onEmailInput);
        };
        okBtn.addEventListener('click', handleOk);
        cancelBtn.addEventListener('click', handleCancel);
        overlay.addEventListener('keydown', handleKey);
    }

    function deleteAdminUser(pin, name) {
        const firebaseDb = B.firebaseDb;
        if (!firebaseDb) return;
        firebaseDb.ref('users').once('value').then(snap => {
            const allUsers = snap.val() || {};
            const targetUser = allUsers[pin];
            if (targetUser && AppState.checkHasAdminAccess(targetUser, pin)) {
                const remainingAdmins = Object.keys(allUsers).filter(p => {
                    if (p === '000000' || p === pin) return false;
                    return AppState.checkHasAdminAccess(allUsers[p], p);
                });
                if (remainingAdmins.length === 0) {
                    alert('최소 1명 이상의 관리자 계정이 유지되어야 하므로 삭제할 수 없습니다.');
                    return;
                }
            }
            showConfirmModal(
                `'${name}' (${pin}) 회원을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`,
                () => {
                    const updates = {
                        [`users/${pin}`]: null,
                        [`settlements/${pin}`]: null
                    };
                    AppState.appendAuditUpdate(updates, {
                        action: 'DELETE',
                        targetType: '회원 삭제',
                        targetId: pin,
                        targetLabel: `${name} (${pin})`,
                        summary: `회원 삭제: '${name} (${pin})' 계정 및 정산 데이터 삭제`,
                        details: { 이름: name, PIN: pin }
                    });
                    firebaseDb.ref().update(updates).then(() => {
                        if (typeof B.renderAdminDashboard === 'function') B.renderAdminDashboard();
                    }).catch(err => {
                        console.error('회원 삭제 실패:', err);
                        alert(t('alert.delete_user_failed'));
                    });
                }
            );
        });
    }

    // 요청사항 목록을 모달에 렌더링하고, 리스트 버튼 배지를 갱신
    function renderFeedbackList() {
        const firebaseDb = B.firebaseDb;
        if (!firebaseDb) return;
        firebaseDb.ref('requests').once('value').then(snapshot => {
            const requestsData = snapshot.val() || {};
            const requestList = Object.keys(requestsData)
                .map(key => ({ key, ...requestsData[key] }))
                .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

            const listContainer = document.getElementById('feedback-list-container');
            const unreadCount = requestList.filter(r => !r.read).length;
            document.getElementById('feedback-unread-count').textContent = unreadCount;

            const deleteSelectedBtn = document.getElementById('feedback-delete-selected-btn');

            if (requestList.length === 0) {
                listContainer.innerHTML = `<p style="font-size:0.85rem; color:var(--text-muted); text-align:center; padding:1rem 0;">${t('empty.no_requests')}</p>`;
                if (deleteSelectedBtn) deleteSelectedBtn.classList.add('hidden');
            } else {
                if (deleteSelectedBtn) deleteSelectedBtn.classList.remove('hidden');
                listContainer.innerHTML = requestList.map(req => {
                    const dateStr = req.createdAt ? new Date(req.createdAt).toLocaleString('ko-KR') : '-';
                    const photoHtml = req.photo
                        ? `<img src="${req.photo}" alt="첨부 사진" class="feedback-photo-img" data-key="${AppState.escapeHtml(req.key)}" style="max-width:100%; max-height:220px; border-radius:8px; margin-top:0.5rem; cursor:pointer; display:block;">`
                        : '';
                    return `
                        <div class="feedback-item" data-key="${AppState.escapeHtml(req.key)}" style="border:1px solid var(--card-border); border-radius:10px; padding:0.7rem 0.9rem; ${req.read ? 'opacity:0.6;' : 'background:rgba(245, 158, 11, 0.08); border-color:rgba(245,158,11,0.3);'}">
                            <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem;">
                                <label style="display:flex; align-items:center; gap:0.4rem; font-size:0.88rem; font-weight:600; cursor:pointer;">
                                    <input type="checkbox" class="feedback-select-checkbox" data-key="${AppState.escapeHtml(req.key)}">
                                    ${AppState.escapeHtml(req.userName || '알 수 없음')}${req.clubName ? ` (${AppState.escapeHtml(req.clubName)})` : ''}
                                </label>
                                <span style="font-size:0.72rem; color:var(--text-muted); white-space:nowrap;">${dateStr}</span>
                            </div>
                            <p style="font-size:0.85rem; margin:0.4rem 0 0; white-space:pre-wrap;">${AppState.escapeHtml(req.message || '')}</p>
                            ${photoHtml}
                            <div style="margin-top:0.5rem; display:flex; gap:0.5rem; align-items:center;">
                                ${!req.read ? '<button class="btn-mark-read btn-secondary" data-key="' + AppState.escapeHtml(req.key) + '" style="padding:0.25rem 0.6rem; font-size:0.75rem;">확인 완료</button>' : '<span style="font-size:0.72rem; color:var(--text-muted);">✔️ 확인됨</span>'}
                                <button class="btn-delete-feedback btn-text-danger" data-key="${AppState.escapeHtml(req.key)}" style="padding:0.25rem 0.6rem; font-size:0.75rem;">삭제</button>
                            </div>
                        </div>
                    `;
                }).join('');

                listContainer.querySelectorAll('.btn-mark-read').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const key = btn.getAttribute('data-key');
                        const request = requestsData[key] || {};
                        const updates = { [`requests/${key}/read`]: true };
                        AppState.appendAuditUpdate(updates, {
                            action: 'UPDATE',
                            targetType: '요청사항',
                            targetId: key,
                            targetLabel: (request.message || '').slice(0, 80),
                            summary: `요청사항 확인 완료 처리: ${(request.message || '').slice(0, 120)}`,
                            details: { 요청자: request.userName || '', 요청자PIN: request.pin || '' }
                        });
                        firebaseDb.ref().update(updates).then(() => {
                            renderFeedbackList();
                        });
                    });
                });
                listContainer.querySelectorAll('.btn-delete-feedback').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const key = btn.getAttribute('data-key');
                        const request = requestsData[key] || {};
                        const updates = { [`requests/${key}`]: null };
                        AppState.appendAuditUpdate(updates, {
                            action: 'DELETE',
                            targetType: '요청사항',
                            targetId: key,
                            targetLabel: (request.message || '').slice(0, 80),
                            summary: `요청사항 삭제: ${(request.message || '').slice(0, 120)}`,
                            details: { 요청자: request.userName || '', 요청자PIN: request.pin || '' }
                        });
                        firebaseDb.ref().update(updates).then(() => {
                            renderFeedbackList();
                        });
                    });
                });
                listContainer.querySelectorAll('.feedback-photo-img').forEach(img => {
                    img.addEventListener('click', () => {
                        document.getElementById('modal-img').src = img.src;
                        document.getElementById('modal-caption').textContent = '';
                        document.getElementById('receipt-modal').classList.remove('hidden');
                    });
                });
            }

            const badge = document.getElementById('feedback-list-badge');
            if (badge) {
                if (unreadCount > 0) {
                    badge.textContent = unreadCount;
                    badge.classList.remove('hidden');
                } else {
                    badge.classList.add('hidden');
                }
            }
        });
    }

    return {
        renderAuditLogList,
        loadAuditLogs,
        openAuditLogModal,
        closeAuditLogModal,
        getRoleBadgeHtml,
        changeAdminUserRole,
        editAdminUser,
        deleteAdminUser,
        renderFeedbackList
    };
};
