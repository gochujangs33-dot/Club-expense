// ============================================================
// js/email-report.js — 이메일 보고서 생성·발송 및 파일 공유/다운로드 모듈
// ============================================================
// v1.7.65: app.js 에서 분리
//   - generateEmailReport / buildEmailHtmlBody (맑은 고딕 9pt HTML 본문)
//   - sendReportEmail (Apps Script 웹훅 -> EmailJS -> AndroidShare -> Web Share -> mailto)
//   - dataUrlToFile / fileToBase64 / hydrateHistoryMedia / downloadHistoryExcel
//   - downloadExcelOnly / collectReportFiles / downloadReportFiles / shareSettlementReport

window.__installEmailReport = function (targetAppState) {
    if (!targetAppState || typeof targetAppState !== 'object') return;

    Object.assign(targetAppState, {
        generateEmailReport() {
            const result = SettlementCalculator.calculate(
                this.memberCount,
                this.expenseItems,
                this.previousPrizeTotal,
                this.rules
            );

            const emailReceiver = (this.reportEmail || '').trim();
            const senderEmail = 'Gochujangs33@gmail.com';

            // 실제 자부담: 수동 오버라이드 중이면 그 값, 아니면 항목별 개인카드 합계 기준 (v1.6.215+)
            const finalSelfPay = this.selfPayManuallyOverridden ? this.lastCalculatedSelfPay : Math.round(result.itemSelfPay);
            const finalSupport = result.totalCost - finalSelfPay;
            const finalRatio = result.totalCost > 0 ? finalSelfPay / result.totalCost : 0;

            // Build email subject (클럽명, 행사진행한 날짜, 정산 보고서)
            const _sdi = document.getElementById('settlement-date-input');
            const rawEventDate = (_sdi && _sdi.value)
                ? _sdi.value
                : (this._editingHistoryOriginal?.settlementDate || '');
            let dateStr = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
            if (/^\d{4}-\d{2}-\d{2}$/.test(rawEventDate)) {
                const [ey, em, ed] = rawEventDate.split('-').map(Number);
                dateStr = `${ey}년 ${em}월 ${ed}일`;
            }
            const clubTitle = (this.clubName || '기본 클럽').trim();
            const subject = `${clubTitle}, ${dateStr}, 정산 보고서`;

            // Build email body text
            let body = `[발신 이메일] ${senderEmail}\n`;
            body += `[수신 이메일] ${emailReceiver || '미지정'}\n`;
            body += `[정산 클럽] ${this.clubName || '기본 클럽'}\n`;
            body += `[작성자] ${this.userName || '정산 담당자'}\n\n`;
            body += `안녕하세요,\n${dateStr} 진행된 [${this.clubName || '클럽'}] 비용 정산 내역을 보고합니다.\n\n`;
            body += `=========================================\n`;
            body += `■ 정산 요약\n`;
            body += `-----------------------------------------\n`;
            body += `- 클럽명: ${this.clubName || '기본 클럽'}\n`;
            body += `- 총 소요 비용: ${SettlementCalculator.formatCurrency(result.totalCost)}\n`;
            body += `- 회사 지원금: ${SettlementCalculator.formatCurrency(finalSupport)}\n`;
            body += `- 총 자부담 금액: ${SettlementCalculator.formatCurrency(finalSelfPay)}\n`;
            const actualPerPersonEmail = (result.memberCount > 0 && finalSelfPay > 0)
                ? Math.round(finalSelfPay / result.memberCount)
                : Math.round(result.perPersonSelfPay);
            body += `- 인당 자부담 비용: ${SettlementCalculator.formatCurrency(actualPerPersonEmail)}\n`;
            body += `- 참석 인원: ${result.memberCount}명\n`;
            body += `- 자부담 비율: ${(finalRatio * 100).toFixed(1)}%\n`;
            body += `=========================================\n\n`;

            body += `■ 세부 비용 내역\n`;
            body += `-----------------------------------------\n`;
            if (this.expenseItems.length === 0) {
                body += `등록된 비용 항목이 없습니다.\n`;
            } else {
                this.expenseItems.forEach((item, idx) => {
                    const catName = categoryNameMap[item.category] || item.category;
                    body += `${idx + 1}. [${catName}] ${item.description}: ${SettlementCalculator.formatCurrency(item.amount)}`;
                    if (item.cardType === 'split') {
                        body += ` (법인 ${SettlementCalculator.formatCurrency(item.corporateAmount)} / 개인 ${SettlementCalculator.formatCurrency(item.personalAmount)})`;
                    } else if (item.cardType === 'corporate') {
                        body += ` (전액 법인카드)`;
                    } else if (item.cardType === 'personal') {
                        body += ` (전액 개인카드)`;
                    }
                    body += `\n`;
                });
            }
            body += `\n`;

            body += `■ 참석자 명단 (${this.attendees.length}명)\n`;
            body += `-----------------------------------------\n`;
            if (this.attendees.length === 0) {
                body += `등록된 참석자가 없습니다.\n`;
            } else {
                this.attendees.forEach((att, idx) => {
                    const empId = att.employeeId ? ` (사번: ${att.employeeId})` : '';
                    body += `${idx + 1}. ${att.name}${empId}\n`;
                });
            }
            body += `\n`;

            body += `* 본 정산서는 클럽 비용 정산기를 통해 자동 생성되었습니다.\n`;

            return {
                sender: senderEmail,
                receiver: emailReceiver,
                subject: subject,
                body: body
            };
        },

        // 메일 본문을 맑은 고딕 9pt HTML로 변환
        buildEmailHtmlBody(body) {
            const escaped = this.escapeHtml(String(body || '')).replace(/\r?\n/g, '<br>');
            return `<div style="font-family:'맑은 고딕','Malgun Gothic',sans-serif;font-size:9pt;line-height:1.55;color:#1e293b;">${escaped}</div>`;
        },

        // 이메일 발송 실행 (1. Google Apps Script 엑셀+사진 첨부 자동 발송, 2. EmailJS 텍스트 자동 발송, 3. Web Share / mailto 폴백)
        async sendReportEmail(recipient, sender = 'Gochujangs33@gmail.com', subject, body) {
            const EMAILJS_SERVICE_ID = 'service_yjm2gpq';
            const EMAILJS_TEMPLATE_ID = 'template_t862eth';
            const EMAILJS_PUBLIC_KEY = 'hx7DFf4XX6BP68qm7';

            // 1. Google Apps Script 웹훅이 설정된 경우: 정산서 엑셀 파일(.xlsx, 내부에 행사·영수증 사진 포함)만 동봉해 빠르게 자동 발송
            let webhookUrl = String(this.emailWebhookUrl || '').trim();
            if (!webhookUrl && this.firebaseDb) {
                try {
                    const snap = await this.firebaseDb.ref('globalSettings/emailWebhookUrl').once('value');
                    webhookUrl = String(snap.val() || '').trim();
                    if (webhookUrl) this.emailWebhookUrl = webhookUrl;
                } catch (_) {}
            }
            if (webhookUrl && /^https:\/\/script\.google\.com\/macros\//i.test(webhookUrl)) {
                try {
                    const excelFile = await this.generateExcelFile();
                    const base64 = await this.fileToBase64(excelFile);
                    const attachments = [{
                        name: excelFile.name,
                        mimeType: excelFile.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        base64
                    }];
                    const res = await fetch(webhookUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                        body: JSON.stringify({
                            to: recipient,
                            subject,
                            body,
                            htmlBody: this.buildEmailHtmlBody(body),
                            senderName: '3M 클럽 비용 정산기',
                            attachments
                        })
                    });
                    if (res.ok) {
                        const data = await res.json().catch(() => ({}));
                        if (data && data.success) {
                            console.log(`[Apps Script] 정산서 엑셀 첨부(${excelFile.name}) 자동 발송 완료`);
                            return { success: true, method: 'apps_script', attachmentCount: 1, fileName: excelFile.name };
                        }
                        console.warn('[Apps Script] 응답 오류, EmailJS로 폴백:', data);
                    } else {
                        console.warn('[Apps Script] HTTP 오류, EmailJS로 폴백:', res.status);
                    }
                } catch (gasErr) {
                    console.warn('[Apps Script] 자동 발송 예외, EmailJS로 폴백:', gasErr);
                }
            }

            // 2. EmailJS 클라우드 자동 발송 (Gochujangs33@gmail.com 발신, 텍스트 요약)
            let emailjsSuccess = false;
            try {
                if (window.emailjs && typeof window.emailjs.send === 'function') {
                    await window.emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
                        to_email: recipient,
                        subject: subject,
                        message: body,
                        from_name: '3M 클럽 비용 정산기'
                    }, EMAILJS_PUBLIC_KEY);
                    emailjsSuccess = true;
                    console.log('[EmailJS] SDK 자동 발송 완료');
                } else {
                    // SDK 미로드 환경 대응: REST API 직접 호출
                    const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            service_id: EMAILJS_SERVICE_ID,
                            template_id: EMAILJS_TEMPLATE_ID,
                            user_id: EMAILJS_PUBLIC_KEY,
                            template_params: {
                                to_email: recipient,
                                subject: subject,
                                message: body,
                                from_name: '3M 클럽 비용 정산기'
                            }
                        })
                    });
                    if (res.ok) {
                        emailjsSuccess = true;
                        console.log('[EmailJS] REST API 자동 발송 완료');
                    } else {
                        console.warn('[EmailJS] REST API 발송 실패 상태코드:', res.status);
                    }
                }
            } catch (emailjsErr) {
                console.warn('[EmailJS] 자동 발송 예외 발생, 로컬 공유로 전환:', emailjsErr);
            }

            if (emailjsSuccess) {
                return { success: true, method: 'emailjs' };
            }

            // 2. Android 네이티브 브릿지 (앱 환경)
            if (window.AndroidShare && typeof window.AndroidShare.shareFiles === 'function') {
                try {
                    const files = await this.collectReportFiles();
                    const filesPayload = await Promise.all(files.map(async f => ({
                        name: f.name,
                        mimeType: f.type || 'application/octet-stream',
                        base64: await this.fileToBase64(f)
                    })));
                    window.AndroidShare.shareFiles(JSON.stringify(filesPayload), subject, body, recipient);
                    return { success: true, method: 'android' };
                } catch (err) {
                    console.warn('AndroidShare 실패, 웹 공유로 폴백:', err);
                }
            }

            // 3. Web Share API (모바일/태블릿 등 다중 파일 및 텍스트 공유 지원 브라우저)
            if (navigator.canShare) {
                try {
                    const files = await this.collectReportFiles();
                    if (files.length > 0 && navigator.canShare({ title: subject, text: body, files })) {
                        await navigator.share({ title: subject, text: body, files });
                        return { success: true, method: 'webshare' };
                    }
                } catch (shareErr) {
                    if (shareErr.name === 'AbortError') {
                        console.log('사용자가 공유 시트를 닫음');
                        return { success: false, method: 'aborted' };
                    }
                    console.warn('Web Share 실패, mailto 폴백:', shareErr);
                }
            }

            // 4. PC 및 일반 브라우저: 클립보드 본문 복사 및 mailto 링크 트리거
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(body);
                }
            } catch (_) {}

            // mailto URL 길이 안전 처리 (브라우저 제한 고려)
            let safeBody = body;
            if (safeBody.length > 1500) {
                safeBody = safeBody.slice(0, 1400) + '\n\n... (전체 세부 내역 및 참석자 명단은 클립보드에 복사되었습니다. 메일 본문에 붙여넣기[Ctrl+V]하실 수 있습니다)';
            }

            const mailtoUrl = `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(safeBody)}`;
            const tempLink = document.createElement('a');
            tempLink.href = mailtoUrl;
            tempLink.style.display = 'none';
            document.body.appendChild(tempLink);
            tempLink.click();
            setTimeout(() => {
                if (tempLink.parentNode) tempLink.parentNode.removeChild(tempLink);
            }, 500);

            return { success: true, method: 'mailto' };
        },

        // base64 데이터 URL을 File 객체로 변환
        async dataUrlToFile(dataUrl, fileName) {
            const res = await fetch(dataUrl);
            const blob = await res.blob();
            const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
            return new File([blob], `${fileName}.${ext}`, { type: blob.type });
        },

        // File 객체를 base64 문자열로 변환 (data URL 접두어 제외)
        fileToBase64(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result.split(',')[1]);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
        },

        // 개인 이력은 용량 절감을 위해 첨부 원본을 제외하므로, 과거 엑셀 생성 시 공유 이력의 원본을 보완한다.
        async hydrateHistoryMedia(entry) {
            if (!entry || hasHistoryMedia(entry) || !this.firebaseDb || !entry.id) return entry;
            try {
                const snapshot = await this.firebaseDb.ref(`globalHistory/${entry.id}`).once('value');
                const globalEntry = snapshot.val();
                if (globalEntry && String(globalEntry.id) === String(entry.id)) {
                    return { ...entry, ...globalEntry };
                }
            } catch (err) {
                console.warn('과거 이력 첨부 원본 조회 실패:', err);
            }
            return entry;
        },

        // 이력 항목의 데이터를 기반으로 엑셀 생성 후 다운로드 (AppState를 임시 교체 후 복원)
        async downloadHistoryExcel(entry) {
            entry = await this.hydrateHistoryMedia(entry);
            const sdi = document.getElementById('settlement-date-input');
            const prev = {
                memberCount: this.memberCount, expenseItems: this.expenseItems,
                attendees: this.attendees, clubName: this.clubName, clubId: this.clubId,
                eventPhotos: this.eventPhotos,
                lastCalculatedSelfPay: this.lastCalculatedSelfPay,
                selfPayManuallyOverridden: this.selfPayManuallyOverridden,
                previousPrizeTotal: this.previousPrizeTotal,
                editingHistoryId: this.editingHistoryId,
                sdiVal: sdi ? sdi.value : '',
                rules: JSON.parse(JSON.stringify(this.rules || DefaultRules)),
            };
            try {
                this.memberCount = entry.memberCount || (entry.attendees ? entry.attendees.length : 0);
                this.expenseItems = JSON.parse(JSON.stringify(entry.expenseItems || []));
                this.attendees = JSON.parse(JSON.stringify(entry.attendees || []));
                // 과거 정산 이력에 저장된 당시의 정산 규칙(구간/비율) 스냅샷 우선 적용 (새해에 rules가 변경되어도 과거 엑셀 고정) — v1.6.320
                if (entry.rules && typeof entry.rules === 'object') {
                    this.rules = JSON.parse(JSON.stringify(entry.rules));
                }
                // 구버전 이력은 빈 배열로 명시해 현재 작성 중인 다른 정산 사진이 섞이지 않게 한다.
                this.eventPhotos = JSON.parse(JSON.stringify(getHistoryEventPhotos(entry)));
                this.clubName = entry.clubName || '';
                this.clubId = entry.clubId || '';
                // 이력에 이미 저장된 "실제" 자부담을 그대로 재사용 (항목에서 재계산하지 않음 — 과거 저장값 그대로 재현)
                this.lastCalculatedSelfPay = entry.totalSelfPay || 0;
                this.selfPayManuallyOverridden = true;
                this.previousPrizeTotal = 0;
                this.editingHistoryId = null;
                if (sdi) sdi.value = entry.settlementDate || new Date().toISOString().slice(0, 10);
                const file = await this.generateExcelFile();
                const safeClubName = (entry.clubName || this.clubName || '클럽').replace(/[\\/:*?"<>|]/g, '_');
                const fileDateStr = (entry.settlementDate || (entry.date ? String(entry.date).slice(0, 10) : new Date().toISOString().slice(0, 10))).replace(/-/g, '');
                const creatorPart = entry.creatorName ? `_${entry.creatorName}` : '';
                const downloadFileName = `${safeClubName}(${fileDateStr})${creatorPart}.xlsx`;
                const url = URL.createObjectURL(file);
                const a = document.createElement('a');
                a.href = url; a.download = downloadFileName;
                document.body.appendChild(a); a.click(); document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } catch (err) {
                console.error('이력 엑셀 다운로드 실패:', err);
                alert('엑셀 파일 생성 중 오류가 발생했습니다: ' + (err.message || ''));
            } finally {
                this.memberCount = prev.memberCount; this.expenseItems = prev.expenseItems;
                this.attendees = prev.attendees; this.clubName = prev.clubName;
                this.eventPhotos = prev.eventPhotos;
                this.clubId = prev.clubId; this.lastCalculatedSelfPay = prev.lastCalculatedSelfPay;
                this.selfPayManuallyOverridden = prev.selfPayManuallyOverridden;
                this.previousPrizeTotal = prev.previousPrizeTotal;
                this.editingHistoryId = prev.editingHistoryId;
                if (prev.rules) this.rules = prev.rules;
                if (sdi) sdi.value = prev.sdiVal;
            }
        },

        // 엑셀 파일만 로컬 다운로드 폴더에 저장 (수정 모드이면 이력도 갱신; skipEditSave=true 시 파일 저장만 수행)
        async downloadExcelOnly(skipEditSave = false) {
            if (!this.hasSelectedClub()) {
                alert('먼저 상단에서 정산할 클럽을 선택해 주세요.');
                const clubSel = document.getElementById('club-name-select');
                if (clubSel) {
                    clubSel.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    clubSel.focus();
                }
                return;
            }
            try {
                const file = await this.generateExcelFile();
                const url = URL.createObjectURL(file);
                const a = document.createElement('a');
                a.href = url;
                a.download = file.name;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                // 수정 모드: 이력 항목 갱신
                if (!skipEditSave && this.editingHistoryId) {
                    const _sdi = document.getElementById('settlement-date-input');
                    const settlementDate = (_sdi && _sdi.value)
                        ? _sdi.value : (this._editingHistoryOriginal?.settlementDate || new Date().toISOString().slice(0, 10));
                    const result = SettlementCalculator.calculate(
                        this.memberCount, this.expenseItems, this.previousPrizeTotal, this.rules
                    );
                    const finalTotalSelfPay = this.selfPayManuallyOverridden ? this.lastCalculatedSelfPay : Math.round(result.itemSelfPay);
                    const updatedFields = {
                        memberCount: this.memberCount,
                        nonMemberCount: this.nonMemberCount || 0,
                        eventNote: this.eventNote || '',
                        totalCost: result.totalCost,
                        prizeCost: result.prizeCost,
                        finalSupportAmount: result.totalCost - finalTotalSelfPay,
                        totalSelfPay: finalTotalSelfPay,
                        perPersonSelfPay: this.memberCount > 0 ? Math.round(finalTotalSelfPay / this.memberCount) : result.perPersonSelfPay,
                        selfPayRatio: result.totalCost > 0 ? finalTotalSelfPay / result.totalCost : 0,
                        expenseItems: JSON.parse(JSON.stringify(this.expenseItems)),
                        attendees: JSON.parse(JSON.stringify(this.attendees)),
                        eventPhotos: JSON.parse(JSON.stringify(this.eventPhotos || [])),
                        clubName: this.clubName,
                        clubId: this.clubId || '',
                        settlementDate,
                    };
                    await this.updateHistoryEntry(this.editingHistoryId, updatedFields);
                    this.cancelEditMode();
                    resetSettlementSession();
                }
            } catch (err) {
                console.error("엑셀 파일 다운로드 실패:", err);
                alert(t('alert.excel_download_failed') + err.message);
                throw err;
            }
        },

        // 엑셀(수정된 정산서) + 참석자/영수증 사진 파일 목록 생성
        async collectReportFiles() {
            const files = [];
            files.push(await this.generateExcelFile());

            for (let pi = 0; pi < (this.eventPhotos || []).length; pi++) {
                files.push(await this.dataUrlToFile(this.eventPhotos[pi], `행사_사진${pi + 1}`));
            }

            for (let i = 0; i < this.expenseItems.length; i++) {
                const item = this.expenseItems[i];
                if (item.cardType === 'split') {
                    if (item.corporateReceiptImage) {
                        const label = `영수증_${i + 1}_법인_${categoryNameMap[item.category] || item.category}`;
                        files.push(await this.dataUrlToFile(item.corporateReceiptImage, label));
                    }
                    if (item.personalReceiptImage) {
                        const label = `영수증_${i + 1}_개인_${categoryNameMap[item.category] || item.category}`;
                        files.push(await this.dataUrlToFile(item.personalReceiptImage, label));
                    }
                } else if (item.receiptImage) {
                    const label = `영수증_${i + 1}_${categoryNameMap[item.category] || item.category}`;
                    files.push(await this.dataUrlToFile(item.receiptImage, label));
                }
            }
            return files;
        },

        // 파일들을 브라우저 다운로드로 저장 (메일에 수동 첨부용)
        async downloadReportFiles() {
            const files = await this.collectReportFiles();
            files.forEach(file => {
                const url = URL.createObjectURL(file);
                const a = document.createElement('a');
                a.href = url;
                a.download = file.name;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            });
            if (files.length > 0) {
                alert(t('alert.files_downloaded'));
            }
        },

        // 엑셀 + 사진(참석자/영수증)을 묶어 공유 시트로 전달
        async shareSettlementReport(receiver, subject, body) {
            const statusEl = document.getElementById('share-report-status');
            const setStatus = (msg) => { if (statusEl) statusEl.textContent = msg; };

            try {
                setStatus('파일을 준비하는 중입니다...');

                const files = await this.collectReportFiles();

                const dateStr = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
                const shareData = {
                    title: subject || `[동아리 정산] ${dateStr} 클럽 비용 정산 보고서`,
                    text: body || `${dateStr} 클럽 비용 정산 보고서와 참석자/영수증 사진을 첨부합니다.`,
                    files: files
                };

                if (window.AndroidShare && typeof window.AndroidShare.shareFiles === 'function') {
                    const filesPayload = await Promise.all(files.map(async f => ({
                        name: f.name,
                        mimeType: f.type || 'application/octet-stream',
                        base64: await this.fileToBase64(f)
                    })));
                    window.AndroidShare.shareFiles(JSON.stringify(filesPayload), shareData.title, shareData.text, receiver || '');
                    setStatus('공유 시트가 열렸습니다. 메일 앱을 선택해 전송해주세요.');
                } else if (navigator.canShare && navigator.canShare(shareData)) {
                    await navigator.share(shareData);
                    setStatus('공유 시트가 열렸습니다. 메일 앱을 선택해 전송해주세요.');
                } else if (navigator.canShare && navigator.canShare({ files: [files[0]] })) {
                    await navigator.share({ title: shareData.title, text: shareData.text, files: [files[0]] });
                    setStatus('이 기기는 다중 파일 공유를 지원하지 않아 엑셀 파일만 공유되었습니다.');
                } else {
                    setStatus('이 브라우저/기기는 파일 공유를 지원하지 않습니다. "메일 앱으로 본문 전송" 기능을 이용해주세요.');
                }
            } catch (err) {
                if (err.name === 'AbortError') {
                    setStatus('공유가 취소되었습니다.');
                } else if (err.name === 'NotAllowedError') {
                    console.error(err);
                    setStatus('이 브라우저/환경에서는 파일 공유가 차단되었습니다. "메일 앱 열기" 또는 "본문 복사"를 이용해주세요.');
                } else {
                    console.error(err);
                    setStatus('공유 중 오류가 발생했습니다: ' + err.message);
                }
            }
        }
    });
};
