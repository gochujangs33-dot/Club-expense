// ============================================================
// js/auth-firebase.js — PIN 로그인 · 권한 전환 · Firebase 부트스트랩 모듈
// ============================================================
// v1.7.69: app.js 에서 분리 (AGENTS.md §1-6 불변량 보존)
//   - loadClubRegistry: .on('value') 등록 직전 반드시 .off('value') 호출
//   - _unbindUserRoleListener / _bindUserRoleListener / loadFromFirebase / loadDirectoryShared / loadGlobalSettings
//   - handlePinKeyPress / syncHeaderAdminButton / setAdminMode / switchToOfflineMode

window.__installAuthFirebaseState = function (targetAppState) {
    if (!targetAppState || typeof targetAppState !== 'object') return;

    Object.assign(targetAppState, {
        _unbindUserRoleListener() {
            if (this._userRoleRef) {
                this._userRoleRef.off('value');
                this._userRoleRef = null;
            }
        },

        _bindUserRoleListener(pin) {
            this._unbindUserRoleListener();
            if (!this.firebaseDb || !pin || pin === '000000') return;
            const ref = this.firebaseDb.ref(`users/${pin}`);
            this._userRoleRef = ref;
            ref.on('value', snap => {
                if (!this.isLoggedIn || String(this.currentPin) !== String(pin)) return;
                const userData = snap.val();
                if (!userData) return;
                const nextRole = this.normalizeUserRole(userData, pin);
                const nextAdminAccess = this.checkHasAdminAccess(userData, pin);
                const prevAdminAccess = this.hasAdminAccess;
                this.userRole = nextRole;
                this.hasAdminAccess = nextAdminAccess;
                if (userData.name) this.userName = userData.name;
                if (typeof window._syncHeaderAdminButton === 'function') {
                    window._syncHeaderAdminButton();
                }
                if (prevAdminAccess && !nextAdminAccess && this.isAdminMode && typeof window._forceUserModeOnRevoke === 'function') {
                    window._forceUserModeOnRevoke();
                }
            });
        },

        // Firebase로부터 데이터 가져오기
        loadFromFirebase(pin) {
            return new Promise((resolve, reject) => {
                if (!this.firebaseDb) {
                    reject(new Error("Firebase가 초기화되지 않았습니다."));
                    return;
                }

                if (pin === "000000") {
                    reject(new Error("관리자 전용 비밀번호(000000) 접속은 폐지되었습니다. 본인 PIN 번호로 로그인해 주세요."));
                    return;
                }

                this.firebaseDb.ref(`users/${pin}`).once('value')
                    .then(userSnapshot => {
                        const userData = userSnapshot.val();
                        if (!userData) {
                            reject(new Error("가입되지 않은 PIN 번호입니다. 신규 회원 등록을 진행해 주세요."));
                            return;
                        }
                        this.userName = userData.name;
                        this.userRole = this.normalizeUserRole(userData, pin);
                        this.hasAdminAccess = this.checkHasAdminAccess(userData, pin);
                        this.prevLastLoginAt = userData.lastLoginAt || null;

                        // 현재 접속 시각 및 기본 역할(개발자/회장 초기값) 동기화, 레거시 000000 계정 정리
                        const userMetaUpdates = {
                            [`users/${pin}/lastLoginAt`]: Date.now()
                        };
                        if (userData.role !== this.userRole || userData.isAdmin !== this.hasAdminAccess) {
                            userMetaUpdates[`users/${pin}/role`] = this.userRole;
                            userMetaUpdates[`users/${pin}/isAdmin`] = this.hasAdminAccess;
                        }
                        if (this.hasAdminAccess) {
                            userMetaUpdates['users/000000'] = null;
                        }
                        this.firebaseDb.ref().update(userMetaUpdates).catch(() => {});
                        this._bindUserRoleListener(pin);

                        this.firebaseDb.ref(`settlements/${pin}`).once('value')
                            .then(snapshot => {
                                const data = snapshot.val();
                                if (data) {
                                    // Firebase 데이터가 있을 경우 덮어쓰기
                                    if (data.expenseItems) this.expenseItems = data.expenseItems;
                                    if (data.attendees && Array.isArray(data.attendees)) {
                                        this.attendees = data.attendees;
                                        this.memberCount = this.attendees.length;
                                    } else if (data.memberCount !== undefined) {
                                        this.memberCount = data.memberCount;
                                    }
                                    // directory → 0번 원칙 준수: 공유 명부(settlements/000000/directory) 실시간 리스너로 공유
                                    // rules → globalSettings/rules 실시간 리스너 기준 (관리자 설정값 우선)
                                    // annualBudget → clubRegistry.budget 기준 (관리자 설정값 우선)
                                    // usedBudget → getClubUsedBudget() 으로 동적 계산
                                    // previousPrizeTotal → clubRegistry.prizeUsed 기준
                                    if (data.clubName !== undefined) this.clubName = data.clubName;
                                    if (data.clubId !== undefined) this.clubId = data.clubId;
                                    this.nonMemberCount = Math.max(0, parseInt(data.nonMemberCount, 10) || 0);
                                    this.eventNote = data.eventNote ? String(data.eventNote) : '';
                                    if (data.reportEmail !== undefined && data.reportEmail && data.reportEmail !== 'finance@club.com') {
                                        this.reportEmail = data.reportEmail;
                                        if (!userData.email) {
                                            this.firebaseDb.ref(`users/${pin}/email`).set(data.reportEmail).catch(() => {});
                                        }
                                    } else if (userData.email) {
                                        this.reportEmail = userData.email;
                                        this.firebaseDb.ref(`settlements/${pin}/reportEmail`).set(userData.email).catch(() => {});
                                    }
                                    if (data.saveExcelToDevice !== undefined) this.saveExcelToDevice = data.saveExcelToDevice !== false;
                                    this.settlementHistory = data.settlementHistory || [];
                                    if (data.eventPhotos) {
                                        this.eventPhotos = Array.isArray(data.eventPhotos) ? data.eventPhotos : [data.eventPhotos];
                                    } else if (data.eventPhoto) {
                                        this.eventPhotos = [data.eventPhoto];
                                    }
                                    console.log(`Firebase data loaded successfully for PIN: ${pin} (${this.userName}, role: ${this.userRole})`);
                                } else {
                                    // Firebase에 데이터가 없을 경우(신규 계정) - 이 기기에 남아있던
                                    // 이전 계정의 로컬 데이터를 그대로 올리지 않도록 정산 관련 상태를 초기화
                                    console.log(`No existing data on Firebase for PIN: ${pin}. Resetting local state for new account.`);
                                    this.expenseItems = []; this.eventPhotos = [];
                                    this.attendees = [];
                                    this.memberCount = 0;
                                    this.nonMemberCount = 0;
                                    this.eventNote = '';
                                    this.previousPrizeTotal = 0;
                                    this.annualBudget = 0;
                                    this.usedBudget = 0;
                                    this.clubName = '';
                                    this.settlementHistory = [];
                                    this.eventPhotos = [];
                                    this.reportEmail = userData.email || '';
                                    this.isLoggedIn = true;
                                    this.currentPin = pin;
                                    this.save();
                                }
                                this.isLoggedIn = true;
                                this.currentPin = pin;
                                // 인증 완료 후 공통 설정(정산 규칙·비고 항목·메일 웹훅 URL) 실시간 리스너 재연결
                                this.loadGlobalSettings();

                                // 0번 원칙 준수: 전사원 명부는 공유 명부(settlements/000000/directory)를 실시간 공유 기준으로 로드
                                this.loadDirectoryShared().finally(() => {
                                    // 번들된 전사원 데이터 중 누락된 사람을 클라우드 명부에도 병합
                                    fetch('./lib/employee_directory.json?_=' + Date.now(), { cache: 'no-store' })
                                        .then(res => res.json())
                                        .then(list => this.bulkImportDirectory(list))
                                        .catch(err => console.error("전사원 명부 자동 등록 실패:", err))
                                        .finally(() => {
                                            // 관리자 및 일반 사용자 모두 globalHistory 기준으로 참석 횟수 동기화
                                            this.recalculateDirectoryCountsFromGlobal()
                                                .then(() => {
                                                    this.save();
                                                    if (this.hasAdminAccess) {
                                                        this.cleanupExpiredHistoryMedia().catch(() => {});
                                                    }
                                                    resolve(true);
                                                })
                                                .catch(() => {
                                                    this.recalculateDirectoryCounts();
                                                    this.save();
                                                    if (this.hasAdminAccess) {
                                                        this.cleanupExpiredHistoryMedia().catch(() => {});
                                                    }
                                                    resolve(true);
                                                });
                                        });
                                });
                            })
                            .catch(err => reject(err));
                    })
                    .catch(err => reject(err));
            });
        },

        // 0번 데이터 원칙: 전사원 명부는 관리자(000000) 명부를 유일한 기준으로 실시간 공유
        loadDirectoryShared() {
            if (!this.firebaseDb) return Promise.resolve();
            return new Promise((resolve) => {
                this.firebaseDb.ref('settlements/000000/directory').off('value');
                this.firebaseDb.ref('settlements/000000/directory').on('value', snapshot => {
                    const adminDir = snapshot.val();
                    if (adminDir && typeof adminDir === 'object') {
                        this.directory = adminDir;
                        if (this.isLoggedIn) {
                            this.render();
                        }
                    }
                    resolve();
                }, (err) => {
                    console.warn("전사원 명부 실시간 동기화 오류:", err);
                    resolve();
                });
            });
        },

        loadClubRegistry() {
            if (!this.firebaseDb) return Promise.resolve();
            // 실시간 리스너: 관리자가 클럽명/예산 수정 시 모든 접속자에게 즉시 반영
            return new Promise((resolve) => {
                let initialLoad = true; // 첫 번째 수신은 초기 로드 — 삭제 팝업 억제
                // 기존 리스너 제거 후 재등록 — 탭 전환마다 loadClubRegistry()가 호출돼 리스너가 누적되는 문제 방지
                this.firebaseDb.ref('clubRegistry').off('value');
                this.firebaseDb.ref('clubRegistry').on('value', snapshot => {
                    this._baseClubRegistry = snapshot.val() || {};
                    this.syncActiveClubStateForQueryYear(initialLoad);
                    if (this.hasAdminAccess && this.getActiveQueryYear() === new Date().getFullYear()) {
                        this._autoDeduplicateClubs();
                    }
                    const wasInitialLoad = initialLoad;
                    initialLoad = false;
                    if (wasInitialLoad) resolve();
                }, err => {
                    console.error("클럽 레지스트리 로딩 실패:", err);
                    resolve();
                });

                this.firebaseDb.ref('yearlyClubRegistry').off('value');
                this.firebaseDb.ref('yearlyClubRegistry').on('value', snapshot => {
                    const yrVal = snapshot.val();
                    this.yearlyClubRegistry = (yrVal && typeof yrVal === 'object') ? yrVal : {};
                    this.syncActiveClubStateForQueryYear(true);
                }, err => {
                    console.error("연도별 클럽 레지스트리 로딩 실패:", err);
                });

                this.firebaseDb.ref('clubTotalBudget').off('value');
                this.firebaseDb.ref('clubTotalBudget').on('value', snapshot => {
                    this._baseClubTotalBudget = snapshot.val() || 0;
                    this.clubTotalBudget = this.getClubTotalBudgetForYear();
                    if (typeof window._onClubTotalBudgetUpdate === 'function') {
                        window._onClubTotalBudgetUpdate();
                    }
                }, err => {
                    console.error("총 클럽예산 로딩 실패:", err);
                });

                this.firebaseDb.ref('yearlyClubTotalBudget').off('value');
                this.firebaseDb.ref('yearlyClubTotalBudget').on('value', snapshot => {
                    const ybVal = snapshot.val();
                    this.yearlyClubTotalBudget = (ybVal && typeof ybVal === 'object') ? ybVal : {};
                    this.clubTotalBudget = this.getClubTotalBudgetForYear();
                    if (typeof window._onClubTotalBudgetUpdate === 'function') {
                        window._onClubTotalBudgetUpdate();
                    }
                }, err => {
                    console.error("연도별 총 클럽예산 로딩 실패:", err);
                });
            });
        },

        saveClubRegistry() {
            if (!this.firebaseDb) return;
            const targetY = this.getActiveQueryYear();
            const updates = { [`yearlyClubRegistry/${targetY}`]: this.clubRegistry };
            if (targetY === new Date().getFullYear()) {
                updates['clubRegistry'] = this.clubRegistry;
            }
            this.firebaseDb.ref().update(updates).catch(err => console.error("클럽 레지스트리 저장 실패:", err));
        },

        // 관리자가 저장한 자부담 구간/비율 설정 및 공통 비고 항목을 모든 유저에게 실시간 동기화
        loadGlobalSettings() {
            if (!this.firebaseDb) return;
            this.firebaseDb.ref('globalSettings/rules').off('value');
            this.firebaseDb.ref('globalSettings/rules').on('value', snapshot => {
                const rules = snapshot.val();
                if (rules && typeof rules === 'object') {
                    this.rules = { ...this.rules, ...rules };
                    if (typeof window._onGlobalSettingsUpdate === 'function') window._onGlobalSettingsUpdate();
                }
            }, err => console.error('globalSettings 로딩 실패:', err));

            this.firebaseDb.ref('globalSettings/noteOptions').off('value');
            this.firebaseDb.ref('globalSettings/noteOptions').on('value', snapshot => {
                const notes = snapshot.val();
                if (Array.isArray(notes)) {
                    this.customNoteOptions = notes.map(n => String(n || '').trim()).filter(Boolean);
                    if (typeof window._renderEventNoteOptions === 'function') window._renderEventNoteOptions();
                }
            }, err => console.error('globalSettings/noteOptions 로딩 실패:', err));

            this.firebaseDb.ref('globalSettings/yearlyRules').off('value');
            this.firebaseDb.ref('globalSettings/yearlyRules').on('value', snapshot => {
                const yrMap = snapshot.val();
                this.yearlyRules = (yrMap && typeof yrMap === 'object') ? yrMap : {};
                if (typeof window._onYearlyRulesUpdate === 'function') window._onYearlyRulesUpdate();
            }, err => console.error('globalSettings/yearlyRules 로딩 실패:', err));

            this.firebaseDb.ref('globalSettings/emailWebhookUrl').off('value');
            this.firebaseDb.ref('globalSettings/emailWebhookUrl').on('value', snapshot => {
                this.emailWebhookUrl = String(snapshot.val() || '').trim();
                const webhookInput = document.getElementById('admin-email-webhook-input');
                if (webhookInput && document.activeElement !== webhookInput) {
                    webhookInput.value = this.emailWebhookUrl;
                }
            }, err => console.error('globalSettings/emailWebhookUrl 로딩 실패:', err));
        },

        saveEmailWebhookUrl(url) {
            const cleanUrl = String(url || '').trim();
            this.emailWebhookUrl = cleanUrl;
            if (!this.firebaseDb) return Promise.resolve(false);
            const updates = { 'globalSettings/emailWebhookUrl': cleanUrl };
            this.appendAuditUpdate(updates, {
                action: 'UPDATE',
                targetType: '메일 웹훅 설정',
                targetId: 'emailWebhookUrl',
                targetLabel: '정산서 엑셀 자동 첨부 메일 설정',
                summary: cleanUrl ? 'Google Apps Script 첨부 메일 웹훅 URL 저장' : 'Google Apps Script 첨부 메일 웹훅 URL 해제'
            });
            return this.firebaseDb.ref().update(updates)
                .then(() => true)
                .catch(err => {
                    console.error('emailWebhookUrl 저장 실패:', err);
                    return false;
                });
        },

        saveCustomNoteOptions() {
            try {
                localStorage.setItem('club_custom_note_options', JSON.stringify(this.customNoteOptions || []));
            } catch (_) {}
            if (!this.firebaseDb) return Promise.resolve(false);
            return this.firebaseDb.ref('globalSettings/noteOptions').set(this.customNoteOptions || [])
                .then(() => true)
                .catch(err => {
                    console.error('공통 비고 항목 저장 실패:', err);
                    return false;
                });
        }
    });
};

window.__installAuthFirebaseUI = function (B) {
    const pinModal = document.getElementById('pin-login-modal');
    const pinDots = document.querySelectorAll('.pin-dot');
    const pinErrorText = document.getElementById('pin-error-text');
    const statusBadge = document.getElementById('login-status-badge');
    const logoutBtn = document.getElementById('header-logout-btn');
    const loginBtn = document.getElementById('header-login-btn');
    const headerAdminModeBtn = document.getElementById('header-admin-mode-btn');

    let pinInputBuffer = "";

    function updatePinDots() {
        pinDots.forEach((dot, idx) => {
            if (idx < pinInputBuffer.length) {
                dot.classList.add('active');
            } else {
                dot.classList.remove('active');
            }
        });
    }

    function resetPinInput() {
        pinInputBuffer = "";
        updatePinDots();
    }

    function handlePinKeyPress(val) {
        const firebaseDb = B.firebaseDb;
        if (val === 'clear') {
            resetPinInput();
            pinErrorText.classList.add('hidden');
        } else if (val === 'back') {
            if (pinInputBuffer.length > 0) {
                pinInputBuffer = pinInputBuffer.slice(0, -1);
                updatePinDots();
                pinErrorText.classList.add('hidden');
            }
        } else {
            if (pinInputBuffer.length < 6) {
                pinInputBuffer += val;
                updatePinDots();
                pinErrorText.classList.add('hidden');

                if (pinInputBuffer.length === 6) {
                    const pin = pinInputBuffer;
                    if (!firebaseDb) {
                        pinErrorText.textContent = "Firebase 설정 키가 누락되었습니다. app.js에서 설정을 기입해 주세요.";
                        pinErrorText.classList.remove('hidden');
                        setTimeout(() => {
                            switchToOfflineMode();
                        }, 2500);
                        return;
                    }

                    AppState.loadFromFirebase(pin).then(() => {
                        pinModal.classList.add('hidden');
                        statusBadge.className = 'badge-online';
                        const roleBadgeText = AppState.userRole === 'president' ? ' 👑회장' : (AppState.userRole === 'developer' ? ' 💻개발자' : (AppState.hasAdminAccess ? ' 🛡️관리자' : ''));
                        statusBadge.innerHTML = `${t('status.online')} (${AppState.userName || t('status.unknown') || '?'}${roleBadgeText} / PIN: ${pin})`;
                        logoutBtn.style.display = 'inline-block';
                        loginBtn.style.display = 'none';
                        resetPinInput();
                        const lastLoginEl = document.getElementById('last-login-info');
                        if (lastLoginEl) {
                            lastLoginEl.textContent = AppState.prevLastLoginAt
                                ? `최근 접속: ${new Date(AppState.prevLastLoginAt).toLocaleString('ko-KR')}`
                                : '최근 접속: 첫 번째 로그인';
                            lastLoginEl.style.display = 'block';
                        }

                        // 로그인 직후에는 항상 사용자 페이지(비용 정산 화면)로 진입하며,
                        // 관리자 권한 보유자(회장/개발자/추가 관리자)에게는 상단에 [👑 관리자 페이지] 전환 버튼을 표시한다.
                        setAdminMode(false);
                        syncHeaderAdminButton();

                        // 클럽 레지스트리를 먼저 받은 뒤 해당 클럽 이력을 로드해야
                        // 과거 상품비 누적 복구값이 구형 레지스트리 값(0원)에 다시 덮이지 않는다.
                        if (B.memberInput) B.memberInput.value = AppState.memberCount || 0;
                        if (B.prizeInput) B.prizeInput.value = AppState.previousPrizeTotal || 0;
                        if (typeof B.setSettingsFormValues === 'function') B.setSettingsFormValues(AppState.rules);
                        if (typeof B.setAdminRulesFormValues === 'function') B.setAdminRulesFormValues(AppState.rules);
                        AppState.loadClubRegistry().then(() => {
                            if (typeof B.renderClubOptions === 'function') B.renderClubOptions();
                            // 로그인 시 현재 클럽의 전체 이력을 globalHistory에서 로드 → 잔여 예산·상품비 누적 정확화
                            if (AppState.clubName || AppState.clubId) return AppState.loadClubHistory();
                        }).then(() => AppState.render());
                    }).catch(err => {
                        console.error(err);
                        pinErrorText.textContent = err.message || "서버 연결에 실패했습니다.";
                        pinErrorText.classList.remove('hidden');
                        resetPinInput();
                    });
                }
            }
        }
    }

    // Keyboard support for PIN entry
    document.addEventListener('keydown', (e) => {
        if (pinModal.classList.contains('hidden')) return;
        if (document.activeElement && ['register-name-input', 'register-email-prefix-input', 'register-pin-input'].includes(document.activeElement.id)) return;
        if (e.key >= '0' && e.key <= '9') {
            handlePinKeyPress(e.key);
        } else if (e.key === 'Backspace') {
            handlePinKeyPress('back');
        } else if (e.key === 'Escape') {
            handlePinKeyPress('clear');
        }
    });

    function syncHeaderAdminButton() {
        if (!headerAdminModeBtn) return;
        if (AppState.isLoggedIn && AppState.hasAdminAccess) {
            headerAdminModeBtn.classList.remove('hidden');
            headerAdminModeBtn.style.display = 'inline-flex';
            if (AppState.isAdminMode) {
                headerAdminModeBtn.innerHTML = '👤 사용자 페이지';
                headerAdminModeBtn.title = '사용자 비용 정산 페이지로 돌아가기';
                headerAdminModeBtn.style.background = 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(5, 150, 105, 0.14))';
                headerAdminModeBtn.style.borderColor = 'rgba(16, 185, 129, 0.5)';
                headerAdminModeBtn.style.color = '#059669';
            } else {
                headerAdminModeBtn.innerHTML = '👑 관리자 페이지';
                headerAdminModeBtn.title = '관리자 대시보드 페이지로 이동';
                headerAdminModeBtn.style.background = 'linear-gradient(135deg, rgba(245, 158, 11, 0.18), rgba(217, 119, 6, 0.12))';
                headerAdminModeBtn.style.borderColor = 'rgba(245, 158, 11, 0.45)';
                headerAdminModeBtn.style.color = '#d97706';
            }
        } else {
            headerAdminModeBtn.classList.add('hidden');
            headerAdminModeBtn.style.display = 'none';
        }
        if (AppState.isLoggedIn && statusBadge && AppState.currentPin) {
            const roleBadgeText = AppState.userRole === 'president' ? ' 👑회장' : (AppState.userRole === 'developer' ? ' 💻개발자' : (AppState.hasAdminAccess ? ' 🛡️관리자' : ''));
            statusBadge.innerHTML = `${t('status.online')} (${AppState.userName || t('status.unknown') || '?'}${roleBadgeText} / PIN: ${AppState.currentPin})`;
        }
    }
    window._syncHeaderAdminButton = syncHeaderAdminButton;
    window._forceUserModeOnRevoke = () => {
        setAdminMode(false);
        syncHeaderAdminButton();
    };

    if (headerAdminModeBtn) {
        headerAdminModeBtn.addEventListener('click', () => {
            if (!AppState.isLoggedIn || !AppState.hasAdminAccess) return;
            setAdminMode(!AppState.isAdminMode);
        });
    }

    function setAdminMode(isAdmin) {
        const firebaseDb = B.firebaseDb;
        const allowAdmin = Boolean(isAdmin && AppState.isLoggedIn && AppState.hasAdminAccess);
        AppState.isAdminMode = allowAdmin;

        // 관리자 모드: 헤더 문구 변경 및 클럽 선택 영역 숨김
        const headerTitleEl = document.querySelector('.logo-area h1');
        if (headerTitleEl) headerTitleEl.textContent = allowAdmin ? '총 클럽 비용 관리' : '클럽 비용 정산';
        const clubNameWrapperEl = document.querySelector('.club-name-wrapper');
        if (clubNameWrapperEl) clubNameWrapperEl.classList.toggle('hidden', allowAdmin);

        const adminOnlyIds = ['admin-tab-btn', 'club-history-tab-btn', 'charts-tab-btn', 'admin-audit-log-btn', 'admin-interim-summary-btn', 'admin-export-ppt-btn', 'history-export-ppt-btn'];
        const memberOnlyIds = ['settlement-tab-btn', 'attendees-tab-btn', 'history-tab-btn'];
        adminOnlyIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.toggle('hidden', !allowAdmin);
        });
        memberOnlyIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.toggle('hidden', allowAdmin);
        });

        // 일반 회원 모드: 요청사항 보내기 버튼 표시 / 관리자 모드: 요청사항 리스트 버튼 표시
        const feedbackOpenBtnEl = document.getElementById('feedback-open-btn');
        const feedbackListOpenBtnEl = document.getElementById('feedback-list-open-btn');
        if (feedbackOpenBtnEl) feedbackOpenBtnEl.classList.toggle('hidden', allowAdmin);
        if (feedbackListOpenBtnEl && !allowAdmin) feedbackListOpenBtnEl.classList.add('hidden');

        syncHeaderAdminButton();

        // 관리자 모드에서는 새 요청사항이 도착하면 알림 팝업을 띄우고, 리스트 버튼을 표시
        if (allowAdmin && firebaseDb) {
            firebaseDb.ref('requests').off('value');
            firebaseDb.ref('requests').on('value', snapshot => {
                const requestsData = snapshot.val() || {};
                const requestList = Object.keys(requestsData)
                    .map(key => ({ key, ...requestsData[key] }))
                    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
                const unreadCount = requestList.filter(r => !r.read).length;

                const badge = document.getElementById('feedback-list-badge');
                if (badge) {
                    if (unreadCount > 0) {
                        badge.textContent = unreadCount;
                        badge.classList.remove('hidden');
                    } else {
                        badge.classList.add('hidden');
                    }
                }

                // 새로 도착한(아직 본 적 없는) 안읽은 요청은 팝업 큐에 추가
                requestList.forEach(req => {
                    if (!req.read && !B.seenFeedbackKeys.has(req.key)) {
                        B.seenFeedbackKeys.add(req.key);
                        B.feedbackPopupQueue.push(req);
                    }
                });
                if (typeof B.showNextFeedbackPopup === 'function') B.showNextFeedbackPopup();

                // 안읽은 요청이 있으면(팝업 확인 전이라도) 리스트 버튼 노출
                if (feedbackListOpenBtnEl && unreadCount > 0) {
                    feedbackListOpenBtnEl.classList.remove('hidden');
                }
            });
        } else if (!allowAdmin && firebaseDb) {
            firebaseDb.ref('requests').off('value');
        }

        // 활성 탭이 더 이상 보이지 않으면 기본 탭으로 전환
        const activeBtn = document.querySelector('.tab-nav .tab-btn.active');
        if (!activeBtn || activeBtn.classList.contains('hidden')) {
            const fallbackId = allowAdmin ? 'tab-admin' : 'tab-settlement';
            document.querySelectorAll('.tab-nav .tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
            const fallbackBtn = document.querySelector(`[data-tab="${fallbackId}"]`);
            if (fallbackBtn) fallbackBtn.classList.add('active');
            const fallbackPane = document.getElementById(fallbackId);
            if (fallbackPane) fallbackPane.classList.remove('hidden');
            if (allowAdmin && typeof B.renderAdminDashboard === 'function') {
                B.renderAdminDashboard();
            } else if (!allowAdmin) {
                AppState.render();
            }
        }
    }

    function switchToOfflineMode() {
        AppState._unbindUserRoleListener();
        AppState.userRole = 'member';
        AppState.hasAdminAccess = false;
        AppState.isAdminMode = false;
        pinModal.classList.add('hidden');
        statusBadge.className = 'badge-offline';
        statusBadge.textContent = t('header.offline');
        logoutBtn.style.display = 'none';
        loginBtn.style.display = 'inline-block';
        document.getElementById('admin-tab-btn').classList.add('hidden');
        setAdminMode(false);
        syncHeaderAdminButton();

        // If we were on admin tab, switch back to settlement
        if (document.getElementById('admin-tab-btn').classList.contains('active')) {
            document.querySelectorAll('.tab-nav .tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
            const sTab = document.querySelector('[data-tab="tab-settlement"]');
            if (sTab) sTab.classList.add('active');
            document.getElementById('tab-settlement').classList.remove('hidden');
        }

        AppState.cancelEditMode(); // 수정 모드 중 로그아웃 시 상태 초기화
        AppState.clubHistory = [];
        AppState.isLoggedIn = false;
        AppState.currentPin = null;
        AppState.userName = null;
        resetPinInput();
        AppState.load(); // Load local storage
        if (typeof B.renderClubOptions === 'function') B.renderClubOptions();
        if (B.memberInput) B.memberInput.value = AppState.memberCount || 0;
        if (B.prizeInput) B.prizeInput.value = AppState.previousPrizeTotal || 0;
        if (typeof B.setSettingsFormValues === 'function') B.setSettingsFormValues(AppState.rules);
        AppState.render();
    }

    logoutBtn.addEventListener('click', () => {
        showConfirmModal(
            t('confirm.logout') || '로그아웃 하시겠습니까?',
            () => {
                switchToOfflineMode();
                pinErrorText.classList.add('hidden');
                resetPinInput();
                document.getElementById('login-mode-section').classList.remove('hidden');
                document.getElementById('register-mode-section').classList.add('hidden');
                pinModal.classList.remove('hidden');
            },
            '로그아웃',
            '로그아웃 안내',
            '🚪'
        );
    });

    loginBtn.addEventListener('click', () => {
        pinErrorText.classList.add('hidden');
        resetPinInput();
        document.getElementById('login-mode-section').classList.remove('hidden');
        document.getElementById('register-mode-section').classList.add('hidden');
        pinModal.classList.remove('hidden');
    });

    return {
        pinModal,
        pinErrorText,
        statusBadge,
        logoutBtn,
        loginBtn,
        updatePinDots,
        resetPinInput,
        handlePinKeyPress,
        syncHeaderAdminButton,
        setAdminMode,
        switchToOfflineMode
    };
};
