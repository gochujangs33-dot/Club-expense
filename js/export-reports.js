// ═══════════════════════════════════════════════════════════════════════
// js/export-reports.js — 엑셀 · PPT 출력 모듈 (v1.7.49 부분 모듈화 3단계)
//  - AppState.generateExcelFile : 공식 정산 양식(template.xlsx) 셀 매핑 (⛔ 셀 매핑 변경 금지 — CALCULATION_SPEC.md)
//  - setCellValue / embedImagesIntoXlsx : xlsx XML 직접 치환 · 이미지 삽입
//  - YearEndPptGenerator / 연간 결산 PPT 모달 / 중간 결산 모달·엑셀
//  app.js 이후(defer)에 로드되며, 모달 영역은 app.js DOMContentLoaded 안에서
//  window.__installExportReports(bridge) 호출 시점(원래 코드 위치)에 초기화된다.
// ═══════════════════════════════════════════════════════════════════════

// 공식 정산 양식(template.xlsx)을 불러와 입력 데이터로 채운 엑셀 파일(File 객체) 생성
AppState.generateExcelFile = async function generateExcelFile() {
    const dateStr = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

    const res = await fetch('./lib/template.xlsx');
    const buf = await res.arrayBuffer();
    const zip = await JSZip.loadAsync(buf);

    // 셀 값을 직접 치환하면 캐시된 수식 결과(<v>)와 calcChain이 어긋나
    // Excel에서 "복구" 경고가 뜨고 0/#DIV0! 으로 보일 수 있음.
    // calcChain.xml을 제거하고 fullCalcOnLoad를 설정해 열 때 전체 재계산되도록 함.
    zip.remove('xl/calcChain.xml');
    let workbookXml = await zip.file('xl/workbook.xml').async('string');
    if (/<calcPr[^>]*\/>/.test(workbookXml)) {
        workbookXml = workbookXml.replace(/<calcPr[^>]*\/>/, '<calcPr calcId="191029" fullCalcOnLoad="1"/>');
    } else {
        workbookXml = workbookXml.replace('</workbook>', '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>');
    }
    zip.file('xl/workbook.xml', workbookXml);
    const ctXmlForCalc = await zip.file('[Content_Types].xml').async('string');
    zip.file('[Content_Types].xml', ctXmlForCalc.replace(/<Override PartName="\/xl\/calcChain\.xml"[^>]*\/>/, ''));

    // 비용내역 = sheet2.xml (수식 보존을 위해 셀 XML 직접 치환)
    let sheet2 = await zip.file('xl/worksheets/sheet2.xml').async('string');

    // 엑셀 뷰어에 따라 수식의 캐시된 값(<v>)이 재계산되지 않는 경우가 있어
    // 정산 결과에 관련된 K/L열 셀들을 앱에서 계산한 값으로 직접 기입
    const calcResult = SettlementCalculator.calculate(
        this.attendees.length,
        this.expenseItems,
        this.previousPrizeTotal,
        this.rules
    );
    sheet2 = setCellValue(sheet2, 'K4', calcResult.memberCount, false);   // 참석자 수
    sheet2 = setCellValue(sheet2, 'K6', calcResult.totalCost, false);     // 총 비용 (B)
    sheet2 = setCellValue(sheet2, 'K7', calcResult.eventCost, false);     // 행사비 (C)
    sheet2 = setCellValue(sheet2, 'K8', calcResult.facilityCost, false);  // 시설 및 장비 이용료 (D)
    sheet2 = setCellValue(sheet2, 'K9', calcResult.prizeCost, false);     // 상품 (E)

    // 인당 행사비 (F)=(C)/(A) 및 정산 구간별 인당 비용/자부담 비용 (서식의 30,000/60,000/120,000원,
    // 20%/40%, 85,000원 구간 기준에 맞춰 계산 — calculateSelfPayPerPerson과 동일한 합산 결과를 가짐)
    const F = calcResult.memberCount > 0 ? calcResult.eventCost / calcResult.memberCount : 0;
    const L1 = this.rules.limit1, L2 = this.rules.limit2, L3 = this.rules.limit3,
          R2 = this.rules.rate2, R3 = this.rules.rate3, D4 = this.rules.deduction4;
    const k15 = F <= L1 ? F : 0;
    const k16 = (F > L1 && F <= L2) ? F : (F > L2 ? L2 : 0);
    const k17 = (F > L2 && F <= L3) ? (F - L2) : (F > L3 ? (L3 - L2) : 0);
    const k18 = F > L3 ? F : 0;
    const l15 = 0;
    const l16 = k16 * R2;
    const l17 = k17 * R3;
    const l18 = k18 === 0 ? 0 : (k18 - D4);
    const k20 = l15 + l16 + l17 + l18; // 인당 최소 자부담 비용
    const k21 = k20 * calcResult.memberCount; // 총 최소 자부담 비용
    const k22 = calcResult.totalCost > 0 ? k21 / calcResult.totalCost : ''; // 총 최소 자부담 비율

    if (calcResult.memberCount > 0) {
        sheet2 = setCellValue(sheet2, 'K12', F, false);
        let label12;
        if (calcResult.eventCost === 0) {
            label12 = '';
        } else if (F <= L1) {
            label12 = '전액지원';
        } else if (F <= L2) {
            label12 = `${Math.round(R2 * 100)}% 자체 부담`;
        } else if (F <= L3) {
            label12 = `'나' 구간 자부담 비용 + ${formatAmount(L2)}원 초과 금액에 대해 ${Math.round(R3 * 100)}% 자체 부담`;
        } else {
            label12 = `${formatAmount(D4)}원 이외 금액 자체 부담(최대 인당 ${(D4 / 10000).toLocaleString('ko-KR')}만원 지원)`;
        }
        sheet2 = setCellValue(sheet2, 'L12', label12, true);

        // 정산 구간표(가/나/다/라) 라벨도 현재 설정값 기준으로 갱신
        sheet2 = setCellValue(sheet2, 'J15', `가. (F) ≤ ${formatAmount(L1)}원`, true);
        sheet2 = setCellValue(sheet2, 'J16', `나. ${formatAmount(L1)}원 < (F) ≤ ${formatAmount(L2)}원`, true);
        sheet2 = setCellValue(sheet2, 'J17', `다. ${formatAmount(L2)}원 < (F) ≤ ${formatAmount(L3)}원`, true);
        sheet2 = setCellValue(sheet2, 'J18', `라. ${formatAmount(L3)}원 < (F)`, true);
    } else {
        sheet2 = setCellValue(sheet2, 'K12', '', true);
        sheet2 = setCellValue(sheet2, 'L12', '', true);
    }

    sheet2 = setCellValue(sheet2, 'K15', k15, false);
    sheet2 = setCellValue(sheet2, 'K16', k16, false);
    sheet2 = setCellValue(sheet2, 'K17', k17, false);
    sheet2 = setCellValue(sheet2, 'K18', k18, false);
    sheet2 = setCellValue(sheet2, 'L15', l15, false);
    sheet2 = setCellValue(sheet2, 'L16', l16, false);
    sheet2 = setCellValue(sheet2, 'L17', l17, false);
    sheet2 = setCellValue(sheet2, 'L18', l18, false);
    sheet2 = setCellValue(sheet2, 'K20', k20, false);
    sheet2 = setCellValue(sheet2, 'K21', k21, false);
    if (k22 === '') {
        sheet2 = setCellValue(sheet2, 'K22', '', true);
    } else {
        sheet2 = setCellValue(sheet2, 'K22', k22, false);
    }

    // D5부터 정회원 참석자 이름 입력 (최대 120명, E열 수식이 D열을 Global ID 명단과 대조)
    for (let idx = 0; idx < 120; idx++) {
        const row = 5 + idx;
        const att = this.attendees[idx];
        sheet2 = setCellValue(sheet2, `C${row}`, att ? att.employeeId : '', true);
        sheet2 = setCellValue(sheet2, `D${row}`, att ? att.name : '', true);
    }

    // 5행부터 입력 (서식상 최대 20건)
    this.expenseItems.slice(0, 20).forEach((item, idx) => {
        const row = 5 + idx;
        sheet2 = setCellValue(sheet2, `F${row}`, item.description, true);
        sheet2 = setCellValue(sheet2, `G${row}`, item.amount, false);
        sheet2 = setCellValue(sheet2, `H${row}`, categoryNameMap[item.category] || item.category, true);
    });

    // K24(실제 자부담 비용): 앱에서 계산/수정된 총 자부담 금액을 그대로 입력
    // (수정 없으면 항목별 개인카드 합계, 수정했으면 사용자가 직접 수정한 값 — v1.6.215+)
    const finalSelfPay = this.selfPayManuallyOverridden ? this.lastCalculatedSelfPay : Math.round(calcResult.itemSelfPay);
    sheet2 = setCellValue(sheet2, 'K24', finalSelfPay, false);

    // K25(실제 자부담 비율), L25(정산 결과 안내), K30(총 회사 지원금)
    if (calcResult.totalCost > 0) {
        const k25 = finalSelfPay / calcResult.totalCost;
        sheet2 = setCellValue(sheet2, 'K25', k25, false);
        const diff = finalSelfPay - k21;
        const label25 = diff >= 0
            ? `정산 문제 없음. 최소 자부담 비용보다 ${diff.toLocaleString('ko-KR')}원 추가 부담함`
            : `최소 자부담 비용 미달. ${(-diff).toLocaleString('ko-KR')}원 추가 자부담 필요.`;
        sheet2 = setCellValue(sheet2, 'L25', label25, true);
    } else {
        sheet2 = setCellValue(sheet2, 'K25', '', true);
        sheet2 = setCellValue(sheet2, 'L25', '', true);
    }
    sheet2 = setCellValue(sheet2, 'K30', calcResult.totalCost - finalSelfPay, false);
    // GridCraft 등 외부 엑셀 뷰어에서 Excel 2010 확장 조건부서식(<extLst>) 경고 팝업이 뜨지 않도록 제거
    sheet2 = sheet2.replace(/<extLst>[\s\S]*?<\/extLst>/g, '');

    zip.file('xl/worksheets/sheet2.xml', sheet2);

    // 사진 삽입 위치 구성
    // 행사사진(sheet3): B3부터 좌/우 번갈아 배치
    // 영수증(sheet4): B5부터 법인카드, D5부터 개인카드 영수증 순서대로 아래로 배치
    const placements = [];
    const PHOTO_W = 240, PHOTO_H = 180;     // 행사사진
    const RECEIPT_W = 220, RECEIPT_H = 300; // 영수증
    const RECEIPT_ROW_STEP = 16;

    const eventPhotos = this.eventPhotos || [];
    for (let pi = 0; pi < eventPhotos.length; pi++) {
        placements.push({
            sheetFile: 'sheet3.xml',
            col: 1 + pi * 5, row: 2,
            blob: await this.dataUrlToFile(eventPhotos[pi], `event${pi + 1}`),
            widthPx: PHOTO_W, heightPx: PHOTO_H
        });
    }

    let corpRow = 4, personalRow = 4;
    for (const item of this.expenseItems) {
        if (item.cardType === 'split') {
            if (item.corporateReceiptImage) {
                placements.push({ sheetFile: 'sheet4.xml', col: 1, row: corpRow, blob: await this.dataUrlToFile(item.corporateReceiptImage, 'corp'), widthPx: RECEIPT_W, heightPx: RECEIPT_H });
                corpRow += RECEIPT_ROW_STEP;
            }
            if (item.personalReceiptImage) {
                placements.push({ sheetFile: 'sheet4.xml', col: 3, row: personalRow, blob: await this.dataUrlToFile(item.personalReceiptImage, 'personal'), widthPx: RECEIPT_W, heightPx: RECEIPT_H });
                personalRow += RECEIPT_ROW_STEP;
            }
        } else if (item.receiptImage) {
            if (item.cardType === 'personal') {
                placements.push({ sheetFile: 'sheet4.xml', col: 3, row: personalRow, blob: await this.dataUrlToFile(item.receiptImage, 'personal'), widthPx: RECEIPT_W, heightPx: RECEIPT_H });
                personalRow += RECEIPT_ROW_STEP;
            } else {
                // 법인카드(기본값)
                placements.push({ sheetFile: 'sheet4.xml', col: 1, row: corpRow, blob: await this.dataUrlToFile(item.receiptImage, 'corp'), widthPx: RECEIPT_W, heightPx: RECEIPT_H });
                corpRow += RECEIPT_ROW_STEP;
            }
        }
    }

    if (placements.length > 0) {
        await embedImagesIntoXlsx(zip, placements);
    }

    const wbout = await zip.generateAsync({ type: 'arraybuffer' });
    const settleDateInput = document.getElementById('settlement-date-input');
    const settleDateVal = settleDateInput ? settleDateInput.value : '';
    const fileDateStr = (settleDateVal || formatLocalDateYMD()).replace(/-/g, '');
    const safeClubName = (this.clubName || '클럽').replace(/[\\/:*?"<>|]/g, '_');
    const fileName = `${safeClubName}(${fileDateStr}).xlsx`;
    return new File([wbout], fileName, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
};

// Image compression helper using Canvas
// xlsx(zip) 안에 이미지를 직접 삽입 (xdr drawing). placements: [{sheetFile:'sheet3.xml', col, row, blob, widthPx, heightPx}]
// 셀 XML을 직접 치환 (기존 서식/스타일(s 속성) 보존, 수식(_xlfn 등) 손상 방지)
function setCellValue(xml, ref, value, isString) {
    const escaped = String(value).replace(/[<>&'"]/g, c => ({
        '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;'
    }[c]));

    // 빈 문자열은 inlineStr("")로 채우면 COUNTA가 비어있지 않은 셀로 카운트하므로
    // 진짜 빈 셀(자체 닫힘 <c r="REF" s="N"/>)로 만들어 COUNTA에서 제외되도록 함
    const isEmptyString = isString && String(value) === '';

    // 자체 닫힘 빈 셀: <c r="REF" s="N"/>
    const reSelf = new RegExp(`<c r="${ref}"([^>]*?)/>`);
    const mSelf = xml.match(reSelf);
    if (mSelf) {
        const attrs = mSelf[1].replace(/\st="[^"]*"/, '');
        if (isEmptyString) {
            return xml.replace(reSelf, `<c r="${ref}"${attrs}/>`);
        }
        const replacement = isString
            ? `<c r="${ref}"${attrs} t="inlineStr"><is><t xml:space="preserve">${escaped}</t></is></c>`
            : `<c r="${ref}"${attrs}><v>${value}</v></c>`;
        return xml.replace(reSelf, replacement);
    }

    // 내용이 있는 셀(수식 등): <c r="REF" ...>...</c> — 수식을 제거하고 값으로 치환
    const reFull = new RegExp(`<c r="${ref}"([^>]*?)>[\\s\\S]*?</c>`);
    const mFull = xml.match(reFull);
    if (mFull) {
        const attrs = mFull[1].replace(/\st="[^"]*"/, '');
        if (isEmptyString) {
            return xml.replace(reFull, `<c r="${ref}"${attrs}/>`);
        }
        const replacement = isString
            ? `<c r="${ref}"${attrs} t="inlineStr"><is><t xml:space="preserve">${escaped}</t></is></c>`
            : `<c r="${ref}"${attrs}><v>${value}</v></c>`;
        return xml.replace(reFull, replacement);
    }

    return xml;
}

async function embedImagesIntoXlsx(zip, placements) {
    if (!placements || placements.length === 0) return;

    const EMU_PER_PX = 9525;
    let ctXml = await zip.file('[Content_Types].xml').async('string');

    const bySheet = {};
    placements.forEach(p => { (bySheet[p.sheetFile] = bySheet[p.sheetFile] || []).push(p); });

    let mediaIndex = 1;
    let drawingIndex = 1;
    const extTypes = new Set();

    for (const [sheetFile, items] of Object.entries(bySheet)) {
        const drawingName = `drawing${drawingIndex}.xml`;
        let anchorsXml = '';
        let relsXml = '';

        for (let i = 0; i < items.length; i++) {
            const p = items[i];
            const ext = (p.blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
            extTypes.add(ext);
            const mediaName = `image${mediaIndex}.${ext}`;
            zip.file(`xl/media/${mediaName}`, await p.blob.arrayBuffer());
            const rId = `rId${i + 1}`;
            relsXml += `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${mediaName}"/>`;

            const cx = Math.round(p.widthPx * EMU_PER_PX);
            const cy = Math.round(p.heightPx * EMU_PER_PX);
            anchorsXml += `<xdr:oneCellAnchor><xdr:from><xdr:col>${p.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${p.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="${cx}" cy="${cy}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${i + 2}" name="Picture ${i + 1}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`;
            mediaIndex++;
        }

        const drawingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchorsXml}</xdr:wsDr>`;
        zip.file(`xl/drawings/${drawingName}`, drawingXml);
        zip.file(`xl/drawings/_rels/${drawingName}.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relsXml}</Relationships>`);

        const sheetPath = `xl/worksheets/${sheetFile}`;
        let sheetXml = await zip.file(sheetPath).async('string');
        const sheetRelsPath = `xl/worksheets/_rels/${sheetFile}.rels`;
        let sheetRelsXml;
        let sheetRelId = 'rId1';

        if (zip.file(sheetRelsPath)) {
            sheetRelsXml = await zip.file(sheetRelsPath).async('string');
            const ids = [...sheetRelsXml.matchAll(/Id="rId(\d+)"/g)].map(m => parseInt(m[1], 10));
            const max = ids.length ? Math.max(...ids) : 0;
            sheetRelId = `rId${max + 1}`;
            sheetRelsXml = sheetRelsXml.replace('</Relationships>', `<Relationship Id="${sheetRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/${drawingName}"/></Relationships>`);
        } else {
            sheetRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="${sheetRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/${drawingName}"/></Relationships>`;
        }
        zip.file(sheetRelsPath, sheetRelsXml);

        if (!sheetXml.includes('<drawing ')) {
            sheetXml = sheetXml.replace('</worksheet>', `<drawing r:id="${sheetRelId}"/></worksheet>`);
        }
        zip.file(sheetPath, sheetXml);
        drawingIndex++;
    }

    extTypes.forEach(ext => {
        const ct = ext === 'png' ? 'image/png' : (ext === 'jpg' ? 'image/jpeg' : `image/${ext}`);
        if (!ctXml.includes(`Extension="${ext}"`)) {
            ctXml = ctXml.replace('</Types>', `<Default Extension="${ext}" ContentType="${ct}"/></Types>`);
        }
    });
    for (let d = 1; d < drawingIndex; d++) {
        const part = `/xl/drawings/drawing${d}.xml`;
        if (!ctXml.includes(part)) {
            ctXml = ctXml.replace('</Types>', `<Override PartName="${part}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
        }
    }
    zip.file('[Content_Types].xml', ctXml);
}

window.__installExportReports = function (B) {
    // ══════════════════════════════════════════════════════════════════
    // 연간 클럽 결산 및 마감 PPT 보고서 자동 생성기 (YearEndPptGenerator)
    // ══════════════════════════════════════════════════════════════════
    const YearEndPptGenerator = {
        getAvailableYears(historyList) {
            const years = new Set();
            const currentYear = new Date().getFullYear();
            years.add(currentYear);
            years.add(currentYear + 1);
            Object.keys(AppState.yearlyRules || {}).forEach(k => {
                const y = Number(k);
                if (!Number.isNaN(y) && y >= 2020 && y <= 2040) years.add(y);
            });
            (historyList || []).forEach(e => {
                const y = getHistoryEntryYear(e);
                if (!Number.isNaN(y) && y >= 2020 && y <= 2040) {
                    years.add(y);
                }
            });
            return Array.from(years).sort((a, b) => b - a);
        },

        collectYearData(targetYear, historyList, clubRegistry) {
            const yearEntries = (historyList || []).filter(e => {
                if (!e) return false;
                const y = getHistoryEntryYear(e);
                return y === targetYear;
            });

            let totalSpend = 0;
            let totalSupport = 0;
            let totalSelfPay = 0;
            let eventSpend = 0;
            let facilitySpend = 0;
            let prizeSpend = 0;
            let prizeSupport = 0;
            let prizeSelfPay = 0;

            const companyUniqueAttendees = new Map();
            let totalAttendeesSum = 0;

            yearEntries.forEach(entry => {
                const entryCost = Number(entry.totalCost) || 0;
                const entrySupport = Number(entry.finalSupportAmount) || 0;
                const entrySelfPay = Number(entry.totalSelfPay) || 0;

                totalSpend += entryCost;
                totalSupport += entrySupport;
                totalSelfPay += entrySelfPay;

                const items = getHistoryExpenseItems(entry);
                if (items.length > 0) {
                    items.forEach(item => {
                        const amt = Math.max(0, parseAmount(item.amount));
                        const supp = Math.max(0, parseAmount(item.itemSupportAmount));
                        const self = Math.max(0, parseAmount(item.itemSelfPay));
                        if (item.category === ExpenseCategory.FACILITY) {
                            facilitySpend += amt;
                        } else if (item.category === ExpenseCategory.PRIZE) {
                            prizeSpend += amt;
                            prizeSupport += supp;
                            prizeSelfPay += self;
                        } else {
                            eventSpend += amt;
                        }
                    });
                } else {
                    const prize = getHistoryPrizeCost(entry);
                    prizeSpend += prize;
                    prizeSupport += prize;
                    eventSpend += Math.max(0, entryCost - prize);
                }

                (entry.attendees || []).forEach(a => {
                    if (!a) return;
                    totalAttendeesSum += 1;
                    const key = a.employeeId ? `id:${a.employeeId}` : (a.name ? `name:${a.name}` : null);
                    if (key && !companyUniqueAttendees.has(key)) {
                        companyUniqueAttendees.set(key, { name: a.name || '이름 없음', employeeId: a.employeeId || '' });
                    }
                });
            });

            if (eventSpend + facilitySpend + prizeSpend !== totalSpend) {
                eventSpend = Math.max(0, totalSpend - facilitySpend - prizeSpend);
            }

            const clubs = Object.values(clubRegistry || {});
            let totalBudget = 0;
            clubs.forEach(c => {
                totalBudget += Number(c.budget) || 0;
            });

            const totalRemaining = totalBudget - totalSupport;
            const totalBurnRate = totalBudget > 0 ? (totalSupport / totalBudget) * 100 : 0;
            const totalEventCount = yearEntries.length;
            const avgAttendeesPerEvent = totalEventCount > 0 ? (totalAttendeesSum / totalEventCount).toFixed(1) : '0.0';

            const clubMap = {};
            clubs.forEach(c => {
                clubMap[c.name] = {
                    id: c.id,
                    name: c.name,
                    budget: Number(c.budget) || 0,
                    spend: 0,
                    support: 0,
                    selfPay: 0,
                    eventSpend: 0,
                    facilitySpend: 0,
                    prizeSpend: 0,
                    attendeesSum: 0,
                    uniqueMap: new Map(),
                    entries: []
                };
            });

            yearEntries.forEach(entry => {
                const name = entry.clubName || '기본 클럽';
                if (!clubMap[name]) {
                    clubMap[name] = {
                        id: entry.clubId || '',
                        name: name,
                        budget: 0,
                        spend: 0,
                        support: 0,
                        selfPay: 0,
                        eventSpend: 0,
                        facilitySpend: 0,
                        prizeSpend: 0,
                        attendeesSum: 0,
                        uniqueMap: new Map(),
                        entries: []
                    };
                }
                const c = clubMap[name];
                c.entries.push(entry);
                c.spend += Number(entry.totalCost) || 0;
                c.support += Number(entry.finalSupportAmount) || 0;
                c.selfPay += Number(entry.totalSelfPay) || 0;

                const items = getHistoryExpenseItems(entry);
                if (items.length > 0) {
                    items.forEach(item => {
                        const amt = Math.max(0, parseAmount(item.amount));
                        if (item.category === ExpenseCategory.FACILITY) c.facilitySpend += amt;
                        else if (item.category === ExpenseCategory.PRIZE) c.prizeSpend += amt;
                        else c.eventSpend += amt;
                    });
                } else {
                    const prize = getHistoryPrizeCost(entry);
                    c.prizeSpend += prize;
                    c.eventSpend += Math.max(0, (Number(entry.totalCost) || 0) - prize);
                }

                (entry.attendees || []).forEach(a => {
                    if (!a) return;
                    c.attendeesSum += 1;
                    const key = a.employeeId ? `id:${a.employeeId}` : (a.name ? `name:${a.name}` : null);
                    if (key) {
                        if (!c.uniqueMap.has(key)) {
                            c.uniqueMap.set(key, { name: a.name || '이름 없음', employeeId: a.employeeId || '', count: 0 });
                        }
                        c.uniqueMap.get(key).count += 1;
                    }
                });
            });

            const clubStats = Object.values(clubMap)
                .map(c => {
                    const remaining = c.budget - c.support;
                    const burnRate = c.budget > 0 ? (c.support / c.budget) * 100 : 0;
                    const avgAttendees = c.entries.length > 0 ? (c.attendeesSum / c.entries.length).toFixed(1) : '0.0';
                    return {
                        ...c,
                        remaining,
                        burnRate,
                        avgAttendees,
                        uniqueCount: c.uniqueMap.size,
                        eventCount: c.entries.length
                    };
                })
                .sort((a, b) => {
                    if (b.eventCount !== a.eventCount) return b.eventCount - a.eventCount;
                    return b.spend - a.spend;
                });

            return {
                targetYear,
                totalBudget,
                totalSpend,
                totalSupport,
                totalSelfPay,
                totalRemaining,
                totalBurnRate,
                eventSpend,
                facilitySpend,
                prizeSpend,
                prizeSupport,
                prizeSelfPay,
                companyUniqueCount: companyUniqueAttendees.size,
                totalAttendeesSum,
                totalEventCount,
                avgAttendeesPerEvent,
                clubStats,
                yearEntries
            };
        },

        async generateAndDownload(targetYear, historyList, clubRegistry, onProgress) {
            if (typeof PptxGenJS === 'undefined') {
                throw new Error('PPTX 생성 라이브러리가 로드되지 않았습니다.');
            }

            if (onProgress) onProgress('데이터 분석 및 집계 중...', 15);
            const data = this.collectYearData(targetYear, historyList, clubRegistry);
            const pptx = new PptxGenJS();
            pptx.layout = 'LAYOUT_16x9';
            const font = 'Malgun Gothic';
            const todayStr = formatLocalDateYMD().replace(/-/g, '.');

            // [Slide 1] 표지 (Executive Cover - 라이트 테마 일체화)
            const s1 = pptx.addSlide();
            s1.background = { color: 'F8FAFC' };

            s1.addShape(pptx.ShapeType.roundRect, {
                x: 0.8, y: 0.9, w: 3.4, h: 0.32,
                rectRadius: 0.06, fill: { color: 'EEF2FF' }, line: { color: 'C7D2FE', width: 1 }
            });
            s1.addText('ANNUAL CLUB CLOSING REPORT', {
                x: 0.9, y: 0.92, w: 3.2, h: 0.28,
                fontSize: 9.5, bold: true, color: '4338CA', fontFace: font, align: 'center'
            });

            s1.addShape(pptx.ShapeType.rect, {
                x: 0.8, y: 1.45, w: 0.09, h: 1.55,
                fill: { color: 'E11D48' }, line: { color: 'E11D48', width: 0 }
            });

            s1.addText(`${targetYear}년 3M 클럽 행사 결산 및 마감 보고서`, {
                x: 1.05, y: 1.45, w: 8.3, h: 0.65,
                fontSize: 24, bold: true, color: '0F172A', fontFace: font
            });
            s1.addText('전사 클럽 연간 예산 집행 현황 · 재원(법인/개인) 분석 · 임직원 참여 성과 종합', {
                x: 1.05, y: 2.25, w: 8.3, h: 0.45,
                fontSize: 12.5, color: '475569', fontFace: font
            });

            s1.addShape(pptx.ShapeType.roundRect, {
                x: 0.8, y: 3.75, w: 8.4, h: 0.85,
                rectRadius: 0.08, fill: { color: 'FFFFFF' }, line: { color: 'E2E8F0', width: 1 }
            });

            const metaCols = [
                { title: '결산 기준 연도', val: `${targetYear}년도` },
                { title: '보고서 작성일자', val: todayStr },
                { title: '보고 주관 부서', val: '사내 동호회 운영위원회 (관리자)' }
            ];
            metaCols.forEach((m, idx) => {
                const mx = 0.95 + idx * 2.75;
                s1.addText(m.title, {
                    x: mx, y: 3.87, w: 2.65, h: 0.22,
                    fontSize: 9, color: '64748B', fontFace: font
                });
                s1.addText(m.val, {
                    x: mx, y: 4.12, w: 2.65, h: 0.32,
                    fontSize: 11, bold: true, color: '0F172A', fontFace: font
                });
            });

            if (onProgress) onProgress('고해상도 시각화 차트 렌더링 중...', 35);

            // [Slide 2] 전사 연간 총괄 요약 (Executive Summary)
            const s2 = pptx.addSlide();
            s2.background = { color: 'F8FAFC' };

            s2.addText('EXECUTIVE SUMMARY', {
                x: 0.8, y: 0.32, w: 3.0, h: 0.22,
                fontSize: 9.5, bold: true, color: '2563EB', fontFace: font
            });
            s2.addText(`${targetYear}년 전사 클럽 예산 집행 및 참여 총괄 현황`, {
                x: 0.8, y: 0.54, w: 7.2, h: 0.42,
                fontSize: 19, bold: true, color: '0F172A', fontFace: font
            });
            s2.addText('02 / TOTAL', {
                x: 8.0, y: 0.45, w: 1.2, h: 0.3,
                fontSize: 10, bold: true, color: '94A3B8', fontFace: font, align: 'right'
            });
            s2.addShape(pptx.ShapeType.line, {
                x: 0.8, y: 1.0, w: 8.4, h: 0,
                line: { color: 'E2E8F0', width: 1 }
            });

            const kpiList = [
                { label: '총 배정 예산', val: formatAmount(data.totalBudget) + '원', sub: '전사 연간 배정 예산', col: '0F172A' },
                { label: '회사 지원금 실집행액', val: formatAmount(data.totalSupport) + '원', sub: `잔여 예산 ${formatAmount(data.totalRemaining)}원`, col: '2563EB' },
                { label: '지원금 예산 소진율', val: `${data.totalBurnRate.toFixed(1)}%`, sub: `총 결제액 ${formatAmount(data.totalSpend)}원 (자부담 ${formatAmount(data.totalSelfPay)}원)`, col: data.totalBurnRate >= 80 ? 'D97706' : '059669' },
                { label: '임직원 실참석 인원', val: `실인원 ${data.companyUniqueCount}명`, sub: `연인원 ${data.totalAttendeesSum}명 (행사 ${data.totalEventCount}회)`, col: '0F172A' }
            ];

            kpiList.forEach((kpi, idx) => {
                const x = 0.8 + idx * 2.15;
                s2.addShape(pptx.ShapeType.roundRect, {
                    x, y: 1.12, w: 2.05, h: 0.98,
                    rectRadius: 0.08, fill: { color: 'FFFFFF' }, line: { color: 'E2E8F0', width: 1 }
                });
                s2.addText(kpi.label, {
                    x: x + 0.12, y: 1.20, w: 1.81, h: 0.20,
                    fontSize: 9.0, color: '64748B', fontFace: font
                });
                s2.addText(kpi.val, {
                    x: x + 0.12, y: 1.44, w: 1.81, h: 0.36,
                    fontSize: 13.5, bold: true, color: kpi.col, fontFace: font
                });
                s2.addText(kpi.sub, {
                    x: x + 0.12, y: 1.82, w: 1.81, h: 0.22,
                    fontSize: 8.0, color: '94A3B8', fontFace: font
                });
            });

            // 차트 카드 1: 재원별 지출 구성 (네이티브 도넛 차트 + 수정 가능한 텍스트)
            s2.addShape(pptx.ShapeType.roundRect, {
                x: 0.8, y: 2.20, w: 4.12, h: 2.08,
                rectRadius: 0.08, fill: { color: 'FFFFFF' }, line: { color: 'E2E8F0', width: 1 }
            });
            s2.addText('1. [재원별 분류] 결제 주체 기준 (합계 100%)', {
                x: 0.95, y: 2.28, w: 3.82, h: 0.22,
                fontSize: 10.5, bold: true, color: '1E293B', fontFace: font
            });

            // 네이티브 도넛 차트 1
            s2.addChart(pptx.ChartType.doughnut, [
                {
                    name: '재원별 지출',
                    labels: ['회사 지원금 (법인)', '임직원 자부담 (개인)'],
                    values: [data.totalSupport, data.totalSelfPay]
                }
            ], {
                x: 0.85, y: 2.50, w: 1.85, h: 1.72,
                chartColors: ['2563EB', '0284C7'],
                showPercent: false,
                showValue: false,
                showLegend: false,
                holeSize: 62
            });
            // 도넛 중앙 텍스트 (직접 수정 가능)
            s2.addText(`총 결제액\n${formatAmount(data.totalSpend)}원\n100%`, {
                x: 0.85, y: 3.03, w: 1.85, h: 0.65,
                fontSize: 7.5, bold: true, color: '0F172A', fontFace: font, align: 'center', lineSpacingMultiple: 1.15
            });

            // 우측 범례 및 텍스트 (직접 수정 가능)
            const suppRatio = data.totalSpend > 0 ? ((data.totalSupport / data.totalSpend) * 100).toFixed(1) : '0.0';
            const selfRatio = data.totalSpend > 0 ? ((data.totalSelfPay / data.totalSpend) * 100).toFixed(1) : '0.0';

            // 회사 지원금
            s2.addShape(pptx.ShapeType.roundRect, {
                x: 2.75, y: 2.72, w: 0.08, h: 0.50,
                rectRadius: 0.02, fill: { color: '2563EB' }, line: { color: '2563EB', width: 0 }
            });
            s2.addText('회사 지원금 (법인)', {
                x: 2.9, y: 2.68, w: 1.3, h: 0.2,
                fontSize: 8.5, bold: true, color: '1E293B', fontFace: font
            });
            s2.addText(`${formatAmount(data.totalSupport)}원`, {
                x: 2.9, y: 2.90, w: 1.3, h: 0.2,
                fontSize: 8.0, color: '475569', fontFace: font
            });
            s2.addText(`${suppRatio}%`, {
                x: 4.25, y: 2.72, w: 0.6, h: 0.35,
                fontSize: 9.5, bold: true, color: '2563EB', fontFace: font, align: 'right'
            });

            // 임직원 자부담
            s2.addShape(pptx.ShapeType.roundRect, {
                x: 2.75, y: 3.48, w: 0.08, h: 0.50,
                rectRadius: 0.02, fill: { color: '0284C7' }, line: { color: '0284C7', width: 0 }
            });
            s2.addText('임직원 자부담 (개인)', {
                x: 2.9, y: 3.44, w: 1.3, h: 0.2,
                fontSize: 8.5, bold: true, color: '1E293B', fontFace: font
            });
            s2.addText(`${formatAmount(data.totalSelfPay)}원`, {
                x: 2.9, y: 3.66, w: 1.3, h: 0.2,
                fontSize: 8.0, color: '475569', fontFace: font
            });
            s2.addText(`${selfRatio}%`, {
                x: 4.25, y: 3.48, w: 0.6, h: 0.35,
                fontSize: 9.5, bold: true, color: '0284C7', fontFace: font, align: 'right'
            });

            // 차트 카드 2: 용도별 지출 구성 (네이티브 도넛 차트 + 수정 가능한 텍스트)
            s2.addShape(pptx.ShapeType.roundRect, {
                x: 5.08, y: 2.20, w: 4.12, h: 2.08,
                rectRadius: 0.08, fill: { color: 'FFFFFF' }, line: { color: 'E2E8F0', width: 1 }
            });
            s2.addText('2. [용도별 분류] 비용 성격 기준 (합계 100%)', {
                x: 5.23, y: 2.28, w: 3.82, h: 0.22,
                fontSize: 10.5, bold: true, color: '1E293B', fontFace: font
            });

            // 네이티브 도넛 차트 2
            s2.addChart(pptx.ChartType.doughnut, [
                {
                    name: '용도별 지출',
                    labels: ['행사비 (식대/다과/활동)', '시설·장비비 (대관/장비)', '상품비 (포상/경품/기념)'],
                    values: [data.eventSpend, data.facilitySpend, data.prizeSpend]
                }
            ], {
                x: 5.13, y: 2.50, w: 1.85, h: 1.72,
                chartColors: ['059669', '7C3AED', 'D97706'],
                showPercent: false,
                showValue: false,
                showLegend: false,
                holeSize: 62
            });
            // 도넛 중앙 텍스트 (직접 수정 가능)
            s2.addText(`용도별 지출\n${formatAmount(data.totalSpend)}원\n100%`, {
                x: 5.13, y: 3.03, w: 1.85, h: 0.65,
                fontSize: 7.5, bold: true, color: '0F172A', fontFace: font, align: 'center', lineSpacingMultiple: 1.15
            });

            // 우측 범례 및 텍스트 (직접 수정 가능)
            const evRatio = data.totalSpend > 0 ? ((data.eventSpend / data.totalSpend) * 100).toFixed(1) : '0.0';
            const facRatio = data.totalSpend > 0 ? ((data.facilitySpend / data.totalSpend) * 100).toFixed(1) : '0.0';
            const przRatio = data.totalSpend > 0 ? ((data.prizeSpend / data.totalSpend) * 100).toFixed(1) : '0.0';

            // 행사비
            s2.addShape(pptx.ShapeType.roundRect, {
                x: 7.05, y: 2.58, w: 0.08, h: 0.40,
                rectRadius: 0.02, fill: { color: '059669' }, line: { color: '059669', width: 0 }
            });
            s2.addText('행사비 (식대/다과/활동)', {
                x: 7.2, y: 2.54, w: 1.35, h: 0.18,
                fontSize: 8.0, bold: true, color: '1E293B', fontFace: font
            });
            s2.addText(`${formatAmount(data.eventSpend)}원`, {
                x: 7.2, y: 2.73, w: 1.35, h: 0.18,
                fontSize: 7.5, color: '475569', fontFace: font
            });
            s2.addText(`${evRatio}%`, {
                x: 8.55, y: 2.56, w: 0.6, h: 0.3,
                fontSize: 8.5, bold: true, color: '059669', fontFace: font, align: 'right'
            });

            // 시설·장비비
            s2.addShape(pptx.ShapeType.roundRect, {
                x: 7.05, y: 3.14, w: 0.08, h: 0.40,
                rectRadius: 0.02, fill: { color: '7C3AED' }, line: { color: '7C3AED', width: 0 }
            });
            s2.addText('시설·장비비 (대관/장비)', {
                x: 7.2, y: 3.10, w: 1.35, h: 0.18,
                fontSize: 8.0, bold: true, color: '1E293B', fontFace: font
            });
            s2.addText(`${formatAmount(data.facilitySpend)}원`, {
                x: 7.2, y: 3.29, w: 1.35, h: 0.18,
                fontSize: 7.5, color: '475569', fontFace: font
            });
            s2.addText(`${facRatio}%`, {
                x: 8.55, y: 3.12, w: 0.6, h: 0.3,
                fontSize: 8.5, bold: true, color: '7C3AED', fontFace: font, align: 'right'
            });

            // 상품비
            s2.addShape(pptx.ShapeType.roundRect, {
                x: 7.05, y: 3.70, w: 0.08, h: 0.40,
                rectRadius: 0.02, fill: { color: 'D97706' }, line: { color: 'D97706', width: 0 }
            });
            s2.addText('상품비 (포상/경품/기념)', {
                x: 7.2, y: 3.66, w: 1.35, h: 0.18,
                fontSize: 8.0, bold: true, color: '1E293B', fontFace: font
            });
            s2.addText(`${formatAmount(data.prizeSpend)}원`, {
                x: 7.2, y: 3.85, w: 1.35, h: 0.18,
                fontSize: 7.5, color: '475569', fontFace: font
            });
            s2.addText(`${przRatio}%`, {
                x: 8.55, y: 3.68, w: 0.6, h: 0.3,
                fontSize: 8.5, bold: true, color: 'D97706', fontFace: font, align: 'right'
            });

            // 하단 2대 성과 카드
            s2.addShape(pptx.ShapeType.roundRect, {
                x: 0.8, y: 4.38, w: 4.12, h: 0.88,
                rectRadius: 0.08, fill: { color: 'EFF6FF' }, line: { color: 'BFDBFE', width: 1 }
            });
            s2.addText('👥 임직원 참여 성과 요약', {
                x: 0.95, y: 4.46, w: 3.82, h: 0.20,
                fontSize: 10, bold: true, color: '1D4ED8', fontFace: font
            });
            s2.addText(`• 전사 실참석 인원 : 총 ${data.companyUniqueCount}명 (동일인 중복 제외 실인원)\n• 누적 참석 연인원 : ${data.totalAttendeesSum}명 (행사당 평균 ${data.avgAttendeesPerEvent}명 참여)`, {
                x: 0.95, y: 4.69, w: 3.82, h: 0.50,
                fontSize: 8.8, color: '1E3A8A', fontFace: font, lineSpacingMultiple: 1.35
            });

            s2.addShape(pptx.ShapeType.roundRect, {
                x: 5.08, y: 4.38, w: 4.12, h: 0.88,
                rectRadius: 0.08, fill: { color: 'FEF3C7' }, line: { color: 'FDE68A', width: 1 }
            });
            const yearRules = AppState.getRulesForYear(targetYear, historyList);
            const prizeLimitMan = Math.round((yearRules.prizeLimit || 500000) / 10000);
            s2.addText(`🎁 상품비 규정 관리 현황 (클럽당 연 ${prizeLimitMan}만원 한도)`, {
                x: 5.23, y: 4.46, w: 3.82, h: 0.20,
                fontSize: 10, bold: true, color: 'B45309', fontFace: font
            });
            s2.addText(`• 전사 상품비 집행 총액 : ${formatAmount(data.prizeSpend)}원 (회사 지원 ${formatAmount(data.prizeSupport)}원)\n• 규정 준수율 100% : 전 클럽 연간 한도(${prizeLimitMan}만원) 내 정상 집행`, {
                x: 5.23, y: 4.69, w: 3.82, h: 0.50,
                fontSize: 8.8, color: '78350F', fontFace: font, lineSpacingMultiple: 1.35
            });

            // [Slide 2-B] 해당 연도 정산 구간 및 한도 기준표 (연도별 규칙 반영, 라이트 테마)
            const sRules = pptx.addSlide();
            sRules.background = { color: 'F8FAFC' };
            sRules.addText('SETTLEMENT POLICY & LIMITS', {
                x: 0.8, y: 0.32, w: 4.0, h: 0.22,
                fontSize: 9.5, bold: true, color: '2563EB', fontFace: font
            });
            sRules.addText(`${targetYear}년 적용 정산 구간 및 지원 한도 기준`, {
                x: 0.8, y: 0.54, w: 7.4, h: 0.42,
                fontSize: 19, bold: true, color: '0F172A', fontFace: font
            });
            sRules.addText('POLICY', {
                x: 8.0, y: 0.45, w: 1.2, h: 0.3,
                fontSize: 10, bold: true, color: '94A3B8', fontFace: font, align: 'right'
            });
            sRules.addShape(pptx.ShapeType.line, {
                x: 0.8, y: 1.0, w: 8.4, h: 0,
                line: { color: 'E2E8F0', width: 1 }
            });

            sRules.addText(`• ${targetYear}년도 동호회 행사 정산 시 전 클럽에 공통 적용된 1인당 행사비 구간별 자부담 비율 및 특별 항목 한도 기준입니다.`, {
                x: 0.8, y: 1.14, w: 8.4, h: 0.26,
                fontSize: 9.5, color: '475569', fontFace: font
            });

            const rL1 = formatAmount(yearRules.limit1 || 30000);
            const rL2 = formatAmount(yearRules.limit2 || 60000);
            const rL3 = formatAmount(yearRules.limit3 || 120000);
            const rR2 = Math.round((yearRules.rate2 ?? 0.2) * 100);
            const rR3 = Math.round((yearRules.rate3 ?? 0.4) * 100);
            const rD4 = formatAmount(yearRules.deduction4 || 85000);
            const rPrize = formatAmount(yearRules.prizeLimit || 500000);
            const rFac = formatAmount(yearRules.facilityLimit || 85000);

            const ruleTableRows = [
                [
                    { text: '구간', options: { fill: { color: '1E293B' }, color: 'FFFFFF', bold: true, align: 'center' } },
                    { text: '1인당 행사비 기준', options: { fill: { color: '1E293B' }, color: 'FFFFFF', bold: true, align: 'center' } },
                    { text: '자부담 비율 / 공제 기준', options: { fill: { color: '1E293B' }, color: 'FFFFFF', bold: true, align: 'center' } },
                    { text: '비고 (지원 방식)', options: { fill: { color: '1E293B' }, color: 'FFFFFF', bold: true, align: 'left' } }
                ],
                [
                    { text: '가 구간', options: { bold: true, align: 'center', fill: { color: 'FFFFFF' }, color: '0F172A' } },
                    { text: `${rL1}원 이하`, options: { align: 'center', fill: { color: 'FFFFFF' }, color: '1E293B' } },
                    { text: '0% (전액 회사 지원)', options: { align: 'center', bold: true, fill: { color: 'FFFFFF' }, color: '16A34A' } },
                    { text: '자부담 없음 (전액 법인카드 지원)', options: { align: 'left', fill: { color: 'FFFFFF' }, color: '475569' } }
                ],
                [
                    { text: '나 구간', options: { bold: true, align: 'center', fill: { color: 'F8FAFC' }, color: '0F172A' } },
                    { text: `${rL1}원 초과 ~ ${rL2}원 이하`, options: { align: 'center', fill: { color: 'F8FAFC' }, color: '1E293B' } },
                    { text: `행사비 × ${rR2}%`, options: { align: 'center', bold: true, fill: { color: 'F8FAFC' }, color: '2563EB' } },
                    { text: `인당 행사비의 ${rR2}% 본인 부담`, options: { align: 'left', fill: { color: 'F8FAFC' }, color: '475569' } }
                ],
                [
                    { text: '다 구간', options: { bold: true, align: 'center', fill: { color: 'FFFFFF' }, color: '0F172A' } },
                    { text: `${rL2}원 초과 ~ ${rL3}원 이하`, options: { align: 'center', fill: { color: 'FFFFFF' }, color: '1E293B' } },
                    { text: `나 구간 고정분 + 초과분 × ${rR3}%`, options: { align: 'center', bold: true, fill: { color: 'FFFFFF' }, color: 'D97706' } },
                    { text: `${rL2}원까지 ${rR2}% + 초과 금액 ${rR3}% 부담`, options: { align: 'left', fill: { color: 'FFFFFF' }, color: '475569' } }
                ],
                [
                    { text: '라 구간', options: { bold: true, align: 'center', fill: { color: 'F8FAFC' }, color: '0F172A' } },
                    { text: `${rL3}원 초과`, options: { align: 'center', fill: { color: 'F8FAFC' }, color: '1E293B' } },
                    { text: `행사비 - ${rD4}원`, options: { align: 'center', bold: true, fill: { color: 'F8FAFC' }, color: 'DC2626' } },
                    { text: `최대 인당 ${rD4}원 지원 (초과분 전액 자부담)`, options: { align: 'left', fill: { color: 'F8FAFC' }, color: '475569' } }
                ]
            ];

            sRules.addTable(ruleTableRows, {
                x: 0.8, y: 1.50, w: 8.4,
                colW: [1.1, 2.3, 2.2, 2.8],
                rowH: 0.44,
                fontSize: 9.5, fontFace: font,
                border: { pt: 0.6, color: 'CBD5E1' },
                valign: 'middle'
            });

            sRules.addShape(pptx.ShapeType.roundRect, {
                x: 0.8, y: 4.00, w: 4.1, h: 1.15,
                rectRadius: 0.08, fill: { color: 'FFFFFF' }, line: { color: 'E2E8F0', width: 1 }
            });
            sRules.addText('🎁 상품비 연간 사용 한도', {
                x: 0.98, y: 4.12, w: 3.74, h: 0.24,
                fontSize: 10.5, bold: true, color: 'B45309', fontFace: font
            });
            sRules.addText(`${rPrize}원 / 년 (클럽당)`, {
                x: 0.98, y: 4.40, w: 3.74, h: 0.30,
                fontSize: 15, bold: true, color: '0F172A', fontFace: font
            });
            sRules.addText('정회원 10명 이상 참석 행사에 한해 법인카드로 사용 가능', {
                x: 0.98, y: 4.76, w: 3.74, h: 0.26,
                fontSize: 8.5, color: '64748B', fontFace: font
            });

            sRules.addShape(pptx.ShapeType.roundRect, {
                x: 5.1, y: 4.00, w: 4.1, h: 1.15,
                rectRadius: 0.08, fill: { color: 'FFFFFF' }, line: { color: 'E2E8F0', width: 1 }
            });
            sRules.addText('🏢 시설·장비 이용료 지원 한도', {
                x: 5.28, y: 4.12, w: 3.74, h: 0.24,
                fontSize: 10.5, bold: true, color: '7C3AED', fontFace: font
            });
            sRules.addText(`${rFac}원 / 1인 (정산 1건 기준)`, {
                x: 5.28, y: 4.40, w: 3.74, h: 0.30,
                fontSize: 15, bold: true, color: '0F172A', fontFace: font
            });
            sRules.addText('이사진 승인 시 1인당 한도 × 정회원 수까지 지원 (초과분 자부담)', {
                x: 5.28, y: 4.76, w: 3.74, h: 0.26,
                fontSize: 8.5, color: '64748B', fontFace: font
            });

            // [Slide 3] 클럽별 핵심 성과 벤치마크 및 시각화 (신규 슬라이드)
            const s3 = pptx.addSlide();
            s3.background = { color: 'F8FAFC' };

            s3.addText('CLUB BENCHMARK & INSIGHTS', {
                x: 0.8, y: 0.32, w: 3.5, h: 0.22,
                fontSize: 9.5, bold: true, color: '2563EB', fontFace: font
            });
            s3.addText(`${targetYear}년 클럽별 활동 랭킹 및 예산 소진율 비교`, {
                x: 0.8, y: 0.54, w: 7.2, h: 0.42,
                fontSize: 19, bold: true, color: '0F172A', fontFace: font
            });
            s3.addText('03 / TOTAL', {
                x: 8.0, y: 0.45, w: 1.2, h: 0.3,
                fontSize: 10, bold: true, color: '94A3B8', fontFace: font, align: 'right'
            });
            s3.addShape(pptx.ShapeType.line, {
                x: 0.8, y: 1.0, w: 8.4, h: 0,
                line: { color: 'E2E8F0', width: 1 }
            });

            // 좌측: 클럽별 연간 예산 소진율 현황 (원래 2단 레이아웃 복원 + 클럽별 고유 색상 및 텍스트 수정 가능)
            s3.addShape(pptx.ShapeType.roundRect, {
                x: 0.8, y: 1.15, w: 4.65, h: 4.05,
                rectRadius: 0.08, fill: { color: 'FFFFFF' }, line: { color: 'E2E8F0', width: 1 }
            });
            s3.addText('클럽별 연간 예산 소진율 현황 (%)', {
                x: 0.95, y: 1.25, w: 2.60, h: 0.24,
                fontSize: 10.5, bold: true, color: '1E293B', fontFace: font,
                margin: 0, wrap: false
            });
            s3.addText('클럽별 고유 색상 · 배정 예산 대비', {
                x: 3.20, y: 1.28, w: 2.10, h: 0.20,
                fontSize: 7.2, color: '64748B', fontFace: font, align: 'right',
                margin: 0, wrap: false
            });

            const clubColorMap = (typeof getClubColorMap === 'function') ? getClubColorMap() : {};
            const chartClubs = [...data.clubStats]
                .filter(c => c.budget > 0)
                .sort((a, b) => b.burnRate - a.burnRate); // 소진율 순으로 자연스럽게 정렬

            if (chartClubs.length === 0) {
                s3.addText('해당 연도 배정된 클럽 예산 정보가 없습니다.', {
                    x: 0.95, y: 2.5, w: 4.35, h: 0.4,
                    fontSize: 9.5, color: '94A3B8', fontFace: font, align: 'center'
                });
            } else {
                const displayClubs = chartClubs.slice(0, 8); // 상위 8개 클럽을 2단 구조로 여유있게 배치
                const totalRows = displayClubs.length;
                const startY = 1.56;
                const availH = 3.48;
                const rowH = availH / Math.max(totalRows, 1);
                const barH = 0.16;
                const trackW = 1.95;
                const trackX = 1.88;

                displayClubs.forEach((c, idx) => {
                    const rowY = startY + idx * rowH;
                    const rate = Math.max(0, c.burnRate || 0);

                    // 클럽 고유 색상 추출 (6자리 헥스코드)
                    const rawColor = clubColorMap[c.name] || '#2563EB';
                    const clubHex = (rawColor.startsWith('#') ? rawColor.slice(1) : rawColor).toUpperCase();

                    // 1. 좌측 클럽명 (각 클럽별 고유 색상 글자색 + 클릭하여 직접 텍스트 수정 가능)
                    s3.addText(c.name, {
                        x: 0.92, y: rowY + 0.02, w: 0.90, h: 0.20,
                        fontSize: 8.5, bold: true, color: clubHex, fontFace: font,
                        align: 'left', valign: 'middle', margin: 0, wrap: false
                    });

                    // 2. 수평 막대 트랙 (배경 연회색 라운드 사각형)
                    s3.addShape(pptx.ShapeType.roundRect, {
                        x: trackX, y: rowY + 0.04, w: trackW, h: barH,
                        rectRadius: 0.03, fill: { color: 'F1F5F9' }, line: { color: 'E2E8F0', width: 0.5 }
                    });

                    // 3. 채움 막대 (각 클럽별 고유 색상 막대 도형)
                    const fillW = Math.max(0.06, Math.min(trackW, (rate / 100) * trackW));
                    s3.addShape(pptx.ShapeType.roundRect, {
                        x: trackX, y: rowY + 0.04, w: fillW, h: barH,
                        rectRadius: 0.03, fill: { color: clubHex }, line: { color: clubHex, width: 0 }
                    });

                    // 4. 막대 위 소진율 텍스트 (% 표기, 직접 수정 가능, 여유있는 너비와 margin:0으로 절대 줄바꿈 방지)
                    if (fillW >= 0.70) {
                        s3.addText(`${rate.toFixed(1)}%`, {
                            x: trackX + fillW - 0.70, y: rowY + 0.03, w: 0.66, h: 0.18,
                            fontSize: 7.5, bold: true, color: 'FFFFFF', fontFace: font,
                            align: 'right', valign: 'middle', margin: 0, wrap: false
                        });
                    } else {
                        s3.addText(`${rate.toFixed(1)}%`, {
                            x: trackX + fillW + 0.05, y: rowY + 0.03, w: 0.66, h: 0.18,
                            fontSize: 7.5, bold: true, color: clubHex, fontFace: font,
                            align: 'left', valign: 'middle', margin: 0, wrap: false
                        });
                    }

                    // 5. 막대 아래 사용 금액 및 잔여/초과 설명 (직접 수정 가능)
                    const remainText = c.remaining >= 0 ? `잔여 ${formatAmount(c.remaining)}원` : `초과 ${formatAmount(Math.abs(c.remaining))}원`;
                    s3.addText(`사용 금액: ${formatAmount(c.support)}원 (${remainText})`, {
                        x: trackX, y: rowY + 0.22, w: trackW + 0.40, h: 0.16,
                        fontSize: 7.2, color: '64748B', fontFace: font,
                        align: 'left', valign: 'middle'
                    });

                    // 6. 우측 총 배정 금액 (직접 수정 가능)
                    s3.addText(`배정 ${formatAmount(c.budget)}원`, {
                        x: 3.88, y: rowY + 0.02, w: 1.45, h: 0.20,
                        fontSize: 8.5, bold: true, color: '0F172A', fontFace: font,
                        align: 'right', valign: 'middle'
                    });
                });
            }

            // 우측: 올해의 우수 클럽 & 경영 인사이트 카드
            const mostActiveClub = [...data.clubStats].sort((a, b) => b.eventCount - a.eventCount)[0] || { name: '-', eventCount: 0 };
            const mostPopularClub = [...data.clubStats].sort((a, b) => b.uniqueCount - a.uniqueCount)[0] || { name: '-', uniqueCount: 0 };
            // 배정 예산 내 100% 소진을 이상적으로 평가: 100% 이하이면서 가장 많이 소진한 클럽 우선 (불용 최소화)
            const eligibleUnder100 = data.clubStats.filter(c => c.budget > 0 && c.burnRate <= 100);
            const bestBudgetClub = (eligibleUnder100.length > 0
                ? [...eligibleUnder100].sort((a, b) => b.burnRate - a.burnRate)[0]
                : [...data.clubStats].filter(c => c.budget > 0).sort((a, b) => Math.abs(100 - a.burnRate) - Math.abs(100 - b.burnRate))[0]) || { name: '-', burnRate: 0 };

            s3.addShape(pptx.ShapeType.roundRect, {
                x: 5.6, y: 1.15, w: 3.6, h: 4.05,
                rectRadius: 0.08, fill: { color: 'FFFFFF' }, line: { color: 'E2E8F0', width: 1 }
            });
            s3.addText('🏆 올해의 클럽 랭킹 & 주요 시사점', {
                x: 5.8, y: 1.3, w: 3.2, h: 0.28,
                fontSize: 12, bold: true, color: '1E293B', fontFace: font
            });

            const rankItems = [
                {
                    badge: '🥇 최다 참여 클럽',
                    name: mostPopularClub.name,
                    detail: `실참석 인원 ${mostPopularClub.uniqueCount}명 (연인원 ${mostPopularClub.attendeesSum || 0}명)`,
                    color: '2563EB', bg: 'EFF6FF'
                },
                {
                    badge: '⚡ 최다 활동 클럽',
                    name: mostActiveClub.name,
                    detail: `총 ${mostActiveClub.eventCount}회 정기 행사 주최`,
                    color: 'D97706', bg: 'FFFBEB'
                },
                {
                    badge: '🎯 알뜰 예산 운용 클럽',
                    name: bestBudgetClub.name,
                    detail: `소진율 ${bestBudgetClub.burnRate.toFixed(1)}% (배정 예산 내 불용 최소화)`,
                    color: '059669', bg: 'ECFDF5'
                }
            ];

            rankItems.forEach((r, idx) => {
                const ry = 1.7 + idx * 0.82;
                s3.addShape(pptx.ShapeType.roundRect, {
                    x: 5.8, y: ry, w: 3.2, h: 0.72,
                    rectRadius: 0.06, fill: { color: r.bg }, line: { color: 'E2E8F0', width: 0.5 }
                });
                s3.addText(r.badge, {
                    x: 5.9, y: ry + 0.06, w: 3.0, h: 0.18,
                    fontSize: 8.5, bold: true, color: r.color, fontFace: font
                });
                s3.addText(r.name, {
                    x: 5.9, y: ry + 0.25, w: 3.0, h: 0.24,
                    fontSize: 11.5, bold: true, color: '0F172A', fontFace: font
                });
                s3.addText(r.detail, {
                    x: 5.9, y: ry + 0.48, w: 3.0, h: 0.18,
                    fontSize: 8.5, color: '64748B', fontFace: font
                });
            });

            s3.addShape(pptx.ShapeType.roundRect, {
                x: 5.8, y: 4.25, w: 3.2, h: 0.8,
                rectRadius: 0.06, fill: { color: 'F8FAFC' }, line: { color: 'E2E8F0', width: 1 }
            });
            s3.addText('💡 연간 종합 총평 및 제언', {
                x: 5.9, y: 4.32, w: 3.0, h: 0.18,
                fontSize: 9, bold: true, color: '334155', fontFace: font
            });
            s3.addText(`• 총 ${data.totalEventCount}회 모임 진행으로 임직원 유대감 강화\n• 지원금 예산 소진율 ${data.totalBurnRate.toFixed(1)}%로 안정적 운용 달성`, {
                x: 5.9, y: 4.52, w: 3.0, h: 0.45,
                fontSize: 8.2, color: '475569', fontFace: font, lineSpacingMultiple: 1.2
            });

            if (onProgress) onProgress('클럽별 비교 및 상세 슬라이드 작성 중...', 65);

            // [Slide 4] 클럽별 연간 실적 종합 비교 (Summary Table)
            const s4 = pptx.addSlide();
            s4.background = { color: 'F8FAFC' };

            s4.addText('CLUB COMPARISON TABLE', {
                x: 0.8, y: 0.32, w: 3.5, h: 0.22,
                fontSize: 9.5, bold: true, color: '2563EB', fontFace: font
            });
            s4.addText(`${targetYear}년 클럽별 연간 예산 집행 및 참여 실적 비교표`, {
                x: 0.8, y: 0.54, w: 7.2, h: 0.42,
                fontSize: 19, bold: true, color: '0F172A', fontFace: font
            });
            s4.addText('04 / TOTAL', {
                x: 8.0, y: 0.45, w: 1.2, h: 0.3,
                fontSize: 10, bold: true, color: '94A3B8', fontFace: font, align: 'right'
            });
            s4.addShape(pptx.ShapeType.line, {
                x: 0.8, y: 1.0, w: 8.4, h: 0,
                line: { color: 'E2E8F0', width: 1 }
            });

            const tableColWidths = [0.92, 1.08, 1.08, 1.08, 0.88, 0.54, 0.52, 0.76, 0.98, 0.56];
            const tableHeaders = ['클럽명', '배정 예산', '총 결제액', '회사 지원금', '자부담', '소진율', '실인원', '평균인원', '상품비', '행사수'];
            const s4HeaderRow = tableHeaders.map(h => ({
                text: h,
                options: { fill: '1E293B', color: 'FFFFFF', bold: true, align: 'center', fontSize: 8.0, margin: [2, 1, 2, 1] }
            }));

            const s4Rows = [s4HeaderRow];
            data.clubStats.forEach((c, idx) => {
                const isAlt = idx % 2 === 1;
                const bg = isAlt ? 'F8FAFC' : 'FFFFFF';
                const row = [
                    c.name,
                    formatAmount(c.budget) + '원',
                    formatAmount(c.spend) + '원',
                    formatAmount(c.support) + '원',
                    formatAmount(c.selfPay) + '원',
                    `${c.burnRate.toFixed(1)}%`,
                    `${c.uniqueCount}명`,
                    `${c.avgAttendees}명`,
                    formatAmount(c.prizeSpend) + '원',
                    `${c.eventCount}회`
                ];
                s4Rows.push(row.map((val, cIdx) => ({
                    text: val,
                    options: {
                        fill: bg,
                        align: cIdx === 0 ? 'left' : (cIdx >= 5 ? 'center' : 'right'),
                        fontSize: 8.0,
                        margin: [1, 2, 1, 2]
                    }
                })));
            });

            const s4TotalRow = [
                '합계 / 평균',
                formatAmount(data.totalBudget) + '원',
                formatAmount(data.totalSpend) + '원',
                formatAmount(data.totalSupport) + '원',
                formatAmount(data.totalSelfPay) + '원',
                `${data.totalBurnRate.toFixed(1)}%`,
                `${data.companyUniqueCount}명`,
                `${data.avgAttendeesPerEvent}명`,
                formatAmount(data.prizeSpend) + '원',
                `${data.totalEventCount}회`
            ];
            s4Rows.push(s4TotalRow.map((val, cIdx) => ({
                text: val,
                options: {
                    fill: 'EFF6FF',
                    color: '1E40AF',
                    bold: true,
                    align: cIdx === 0 ? 'left' : (cIdx >= 5 ? 'center' : 'right'),
                    fontSize: 8.2,
                    margin: [2, 1, 2, 1]
                }
            })));

            s4.addTable(s4Rows, {
                x: 0.8, y: 1.15, w: 8.4, colW: tableColWidths,
                fontFace: font,
                border: { type: 'solid', pt: 0.5, color: 'CBD5E1' }
            });

            // [Slide 5 ~ N] 클럽별 상세 활동 이력
            data.clubStats.forEach(club => {
                if (club.entries.length === 0 && club.budget === 0) return;

                const sc = pptx.addSlide();
                sc.background = { color: 'F8FAFC' };
                sc.addText('CLUB ACTIVITY REPORT', {
                    x: 0.8, y: 0.32, w: 3.5, h: 0.22,
                    fontSize: 9.5, bold: true, color: '2563EB', fontFace: font
                });
                sc.addText(`[${club.name}] ${targetYear}년 활동 및 지출 상세 내역`, {
                    x: 0.8, y: 0.54, w: 7.2, h: 0.42,
                    fontSize: 19, bold: true, color: '0F172A', fontFace: font
                });
                sc.addShape(pptx.ShapeType.line, {
                    x: 0.8, y: 1.0, w: 8.4, h: 0,
                    line: { color: 'E2E8F0', width: 1 }
                });

                sc.addShape(pptx.ShapeType.roundRect, {
                    x: 0.8, y: 1.12, w: 8.4, h: 0.58,
                    rectRadius: 0.06, fill: { color: 'FFFFFF' }, line: { color: 'E2E8F0', width: 1 }
                });
                const metaLine1 = `연간 예산 : ${formatAmount(club.budget)}원   |   총 집행액 : ${formatAmount(club.spend)}원 (지원금 소진율 ${club.burnRate.toFixed(1)}%)   |   상품비 : ${formatAmount(club.prizeSpend)}원`;
                const metaLine2 = `참석 : 실인원 ${club.uniqueCount}명 (회당 ${club.avgAttendees}명)`;
                sc.addText(`${metaLine1}\n${metaLine2}`, {
                    x: 0.95, y: 1.16, w: 8.1, h: 0.50,
                    fontSize: 8.8, bold: true, color: '1E293B', fontFace: font,
                    lineSpacingMultiple: 1.25
                });

                // 표: 클럽명은 슬라이드 제목에 이미 있으므로 행사명 컬럼을 생략하고 6개 열로 넓고 쾌적하게 배치
                const timelineColW = [1.15, 1.40, 1.40, 1.40, 1.25, 1.80];
                const timelineHeaders = ['진행 일자', '총 결제액', '회사 지원금', '개인 자부담', '상품비', '참석 인원'];
                const tHeaderRow = timelineHeaders.map(h => ({
                    text: h,
                    options: { fill: '1E293B', color: 'FFFFFF', bold: true, align: 'center', fontSize: 8.5, margin: [3.5, 3, 3.5, 3] }
                }));

                const tRows = [tHeaderRow];
                if (club.entries.length === 0) {
                    tRows.push([
                        { text: '-', options: { align: 'center', fontSize: 8.5, margin: [3, 4, 3, 4] } },
                        { text: '0원', options: { align: 'right', fontSize: 8.5, margin: [3, 4, 3, 4] } },
                        { text: '0원', options: { align: 'right', fontSize: 8.5, margin: [3, 4, 3, 4] } },
                        { text: '0원', options: { align: 'right', fontSize: 8.5, margin: [3, 4, 3, 4] } },
                        { text: '0원', options: { align: 'right', fontSize: 8.5, margin: [3, 4, 3, 4] } },
                        { text: '0명 (등록 내역 없음)', options: { align: 'center', fontSize: 8.5, margin: [3, 4, 3, 4] } }
                    ]);
                } else {
                    club.entries.forEach((e, eIdx) => {
                        const isAlt = eIdx % 2 === 1;
                        const bg = isAlt ? 'F8FAFC' : 'FFFFFF';
                        const dateStr = (e.settlementDate || (e.date ? formatLocalDateYMD(e.date) : '-')).slice(0, 10);
                        const attCount = (e.attendees && e.attendees.length) ? `${e.attendees.length}명` : `${e.attendeeCount || 0}명`;
                        const spendStr = formatAmount(e.totalCost || 0) + '원';
                        const suppStr = formatAmount(e.finalSupportAmount || 0) + '원';
                        const selfStr = formatAmount(e.totalSelfPay || 0) + '원';
                        const prizeStr = formatAmount(getHistoryPrizeCost(e)) + '원';

                        tRows.push([
                            dateStr, spendStr, suppStr, selfStr, prizeStr, attCount
                        ].map((val, cIdx) => ({
                            text: val,
                            options: {
                                fill: bg,
                                align: (cIdx === 0 || cIdx === 5) ? 'center' : 'right',
                                fontSize: 8.5,
                                margin: [3, 4, 3, 4]
                            }
                        })));
                    });

                    tRows.push([
                        `합계 (총 ${club.eventCount}회)`,
                        formatAmount(club.spend) + '원',
                        formatAmount(club.support) + '원',
                        formatAmount(club.selfPay) + '원',
                        formatAmount(club.prizeSpend) + '원',
                        `실인원 ${club.uniqueCount}명`
                    ].map((val, cIdx) => ({
                        text: val,
                        options: {
                            fill: 'EFF6FF',
                            color: '1E40AF',
                            bold: true,
                            align: (cIdx === 0 || cIdx === 5) ? 'center' : 'right',
                            fontSize: 8.5,
                            margin: [4, 4, 4, 4]
                        }
                    })));
                }

                sc.addTable(tRows, {
                    x: 0.8, y: 1.78, w: 8.4, colW: timelineColW,
                    fontFace: font,
                    border: { type: 'solid', pt: 0.5, color: 'CBD5E1' }
                });

                // 하단 여백: 해당 클럽 연간 전체 참석 임직원 명단 및 개인별 참석 횟수 카드 (글자 겹침·칸 이탈 방지 자동 맞춤)
                const memberList = Array.from(club.uniqueMap.values())
                    .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name));

                const memberTexts = memberList.map(m => {
                    const idPart = m.employeeId ? `(${m.employeeId})` : '';
                    return `${m.name}${idPart} ${m.count}회`;
                });

                const estimateRosterLines = (items, fontPt, boxWidthIn = 8.1) => {
                    if (!items || items.length === 0) return 1;
                    // 한글/숫자 혼합 평균 폭(in) 보수적 추정 (약 fontPt * 0.0125 in/char 기준, 10% 여유)
                    const maxUnitsPerLine = (boxWidthIn * 72) / (fontPt * 0.92);
                    const sepUnits = 3.5; // '  •  '
                    let lines = 1;
                    let curUnits = 0;
                    items.forEach((txt, idx) => {
                        let units = 0;
                        for (let i = 0; i < txt.length; i++) {
                            units += txt.charCodeAt(i) > 127 ? 1.05 : 0.62;
                        }
                        const addUnits = (idx > 0 && curUnits > 0 ? sepUnits : 0) + units;
                        if (curUnits > 0 && curUnits + addUnits > maxUnitsPerLine) {
                            lines++;
                            curUnits = units;
                        } else {
                            curUnits += addUnits;
                        }
                    });
                    return lines;
                };

                const pickRosterLayout = (items, availHeightIn, boxWidthIn = 8.1) => {
                    const presets = [
                        { fontSize: 8.5, lineSpacing: 1.25 },
                        { fontSize: 7.8, lineSpacing: 1.18 },
                        { fontSize: 7.2, lineSpacing: 1.14 },
                        { fontSize: 6.6, lineSpacing: 1.10 }
                    ];
                    for (const p of presets) {
                        const lineCount = estimateRosterLines(items, p.fontSize, boxWidthIn);
                        const neededH = lineCount * (p.fontSize / 72) * p.lineSpacing + 0.08;
                        if (neededH <= availHeightIn) {
                            return { ...p, fits: true };
                        }
                    }
                    return { ...presets[presets.length - 1], fits: false };
                };

                const tableApproxH = Math.max(0.62, 0.30 + Math.max(0, tRows.length - 1) * 0.255);
                const sameSlideCardY = 1.78 + tableApproxH + 0.14;
                const sameSlideAvailCardH = 5.34 - sameSlideCardY;
                const sameSlideAvailBodyH = sameSlideAvailCardH - 0.38;
                const sameSlideLayout = pickRosterLayout(memberTexts, Math.max(0, sameSlideAvailBodyH));

                const renderRosterCardOnSlide = (targetSlide, cY, cH, items, titleText, layout) => {
                    targetSlide.addShape(pptx.ShapeType.roundRect, {
                        x: 0.8, y: cY, w: 8.4, h: cH,
                        rectRadius: 0.06, fill: { color: 'FFFFFF' }, line: { color: 'E2E8F0', width: 1 }
                    });
                    targetSlide.addText(titleText, {
                        x: 0.95, y: cY + 0.07, w: 8.1, h: 0.24,
                        fontSize: 9.2, bold: true, color: '1E40AF', fontFace: font, valign: 'top', margin: 0
                    });
                    const bodyText = items.length > 0
                        ? items.join('  •  ')
                        : '해당 연도 등록된 참석자 기록이 없습니다.';
                    targetSlide.addText(bodyText, {
                        x: 0.95, y: cY + 0.33, w: 8.1, h: Math.max(0.4, cH - 0.39),
                        fontSize: layout.fontSize, color: '334155', fontFace: font,
                        lineSpacingMultiple: layout.lineSpacing, valign: 'top', margin: 0
                    });
                };

                const rosterTitle = `👥 [${club.name}] ${targetYear}년 전체 참석 임직원 명단 (실인원 ${club.uniqueCount}명, 누적 연인원 ${club.attendeesSum}명)`;

                if (sameSlideAvailCardH >= 0.88 && sameSlideLayout.fits) {
                    renderRosterCardOnSlide(sc, sameSlideCardY, sameSlideAvailCardH, memberTexts, rosterTitle, sameSlideLayout);
                } else {
                    // 표가 길거나 참석 인원이 많아 현재 슬라이드 하단에 겹침/이탈이 예상되면 별도 슬라이드에 깔끔히 배치
                    const scRoster = pptx.addSlide();
                    scRoster.background = { color: 'F8FAFC' };
                    scRoster.addText('CLUB ACTIVITY REPORT — ATTENDEES', {
                        x: 0.8, y: 0.32, w: 4.5, h: 0.22,
                        fontSize: 9.5, bold: true, color: '2563EB', fontFace: font
                    });
                    scRoster.addText(`[${club.name}] ${targetYear}년 전체 참석 임직원 명단`, {
                        x: 0.8, y: 0.54, w: 8.4, h: 0.42,
                        fontSize: 19, bold: true, color: '0F172A', fontFace: font
                    });
                    scRoster.addShape(pptx.ShapeType.line, {
                        x: 0.8, y: 1.0, w: 8.4, h: 0,
                        line: { color: 'E2E8F0', width: 1 }
                    });
                    const fullCardY = 1.16;
                    const fullCardH = 4.18;
                    const fullLayout = pickRosterLayout(memberTexts, fullCardH - 0.38);
                    renderRosterCardOnSlide(scRoster, fullCardY, fullCardH, memberTexts, rosterTitle, fullLayout);
                }
            });

            // [Slide Last] 결산 마감 및 감사 (Closing Slide - 라이트 테마 일체화)
            const sLast = pptx.addSlide();
            sLast.background = { color: 'F8FAFC' };

            sLast.addShape(pptx.ShapeType.roundRect, {
                x: 1.5, y: 1.3, w: 7.0, h: 3.0,
                rectRadius: 0.1, fill: { color: 'FFFFFF' }, line: { color: 'E2E8F0', width: 1 }
            });

            sLast.addText('THANK YOU', {
                x: 1.5, y: 1.7, w: 7.0, h: 0.6,
                fontSize: 32, bold: true, color: '2563EB', fontFace: font, align: 'center'
            });
            sLast.addText(`${targetYear}년 한 해 동안 동호회 활동에 적극적으로 참여해주신\n모든 임직원 여러분께 진심으로 감사드립니다.`, {
                x: 1.8, y: 2.45, w: 6.4, h: 0.8,
                fontSize: 15, color: '0F172A', fontFace: font, align: 'center', lineSpacingMultiple: 1.3
            });
            sLast.addText(`사내 동호회 운영위원회 (관리자)  |  보고서 발행일자 : ${todayStr}`, {
                x: 1.8, y: 3.45, w: 6.4, h: 0.35,
                fontSize: 10.5, color: '64748B', fontFace: font, align: 'center'
            });

            if (onProgress) onProgress('파워포인트 파일 빌드 중...', 90);

            const fileName = `${targetYear}년_3M_클럽_행사_결산및마감_보고서.pptx`;
            await pptx.writeFile({ fileName });
            return fileName;
        }
    };

    async function openYearEndPptModal() {
        if (!AppState.hasAdminAccess) return;
        const modal = document.getElementById('year-end-ppt-modal');
        if (!modal) return;

        modal.classList.remove('hidden');

        const yearSelect = document.getElementById('year-end-ppt-year-select');
        const previewBox = document.getElementById('year-end-ppt-preview-box');
        if (!yearSelect || !previewBox) return;

        previewBox.innerHTML = '<div style="font-size:0.85rem; color:var(--text-secondary); text-align:center; padding:1rem;">데이터를 불러오는 중입니다...</div>';

        let historyList = B.lastHistoryList;
        if (!historyList || historyList.length === 0) {
            if (firebaseDb) {
                try {
                    const [snapshot, deletedSnap] = await Promise.all([
                        firebaseDb.ref('globalHistory').once('value'),
                        firebaseDb.ref('deletedHistoryIds').once('value')
                    ]);
                    const historyData = snapshot.val() || {};
                    const cachedDeletedIds = deletedSnap.val() || {};
                    historyList = (typeof window.extractValidGlobalHistory === 'function'
                        ? window.extractValidGlobalHistory(historyData, cachedDeletedIds, firebaseDb)
                        : Object.values(historyData).filter(e => e && !cachedDeletedIds[String(e.id)])
                    ).sort(compareHistoryEntriesNewestFirst);
                    B.lastHistoryList = historyList;
                } catch (e) {
                    console.error('globalHistory 로드 실패:', e);
                }
            }
        }

        const years = YearEndPptGenerator.getAvailableYears(historyList);
        const currentYear = new Date().getFullYear();
        const defaultPptYear = (_selectedQueryYear && _selectedQueryYear !== 'ALL')
            ? (Number(_selectedQueryYear) || currentYear)
            : currentYear;

        yearSelect.innerHTML = years.map(y => `<option value="${y}" ${y === defaultPptYear ? 'selected' : ''}>${y}년 결산</option>`).join('');

        function updatePreview() {
            const selYear = parseInt(yearSelect.value, 10) || currentYear;
            const yearClubRegistry = AppState.getClubRegistryForYear(selYear);
            const data = YearEndPptGenerator.collectYearData(selYear, historyList, yearClubRegistry);

            const suppRatio = data.totalSpend > 0 ? ((data.totalSupport / data.totalSpend) * 100).toFixed(1) : '0.0';
            const selfRatio = data.totalSpend > 0 ? ((data.totalSelfPay / data.totalSpend) * 100).toFixed(1) : '0.0';
            const burnRatePct = Math.min(100, Math.max(0, data.totalBurnRate));
            const burnColor = data.totalBurnRate >= 100 ? '#ef4444' : (data.totalBurnRate >= 80 ? '#f59e0b' : '#38bdf8');

            previewBox.innerHTML = `
                <!-- 슬라이드 덱 구성 태그 -->
                <div style="display:flex; flex-wrap:wrap; gap:0.35rem; margin-bottom:0.85rem;">
                    <span style="font-size:0.72rem; padding:0.18rem 0.5rem; border-radius:4px; background:rgba(56,189,248,0.12); color:#38bdf8; border:1px solid rgba(56,189,248,0.25);">📑 16:9 경영진 덱</span>
                    <span style="font-size:0.72rem; padding:0.18rem 0.5rem; border-radius:4px; background:rgba(255,255,255,0.06); color:var(--text-secondary);">총괄 요약</span>
                    <span style="font-size:0.72rem; padding:0.18rem 0.5rem; border-radius:4px; background:rgba(255,255,255,0.06); color:var(--text-secondary);">재원·용도 2대 도넛차트</span>
                    <span style="font-size:0.72rem; padding:0.18rem 0.5rem; border-radius:4px; background:rgba(255,255,255,0.06); color:var(--text-secondary);">소진율 바차트</span>
                    <span style="font-size:0.72rem; padding:0.18rem 0.5rem; border-radius:4px; background:rgba(255,255,255,0.06); color:var(--text-secondary);">종합비교표</span>
                    <span style="font-size:0.72rem; padding:0.18rem 0.5rem; border-radius:4px; background:rgba(255,255,255,0.06); color:var(--text-secondary);">클럽별 타임라인</span>
                </div>

                <!-- 4대 KPI 그리드 -->
                <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:0.6rem; font-size:0.84rem;">
                    <div style="background:rgba(255,255,255,0.04); padding:0.65rem 0.8rem; border-radius:8px; border:1px solid rgba(255,255,255,0.06);">
                        <span style="color:var(--text-secondary); font-size:0.74rem; display:block;">총 집행액 (총 지출)</span>
                        <strong style="font-size:1.05rem; color:var(--text-primary);">${formatAmount(data.totalSpend)}원</strong>
                        <div style="font-size:0.72rem; color:var(--text-secondary); margin-top:0.2rem;">총 ${data.totalEventCount}회 행사 진행</div>
                    </div>
                    <div style="background:rgba(255,255,255,0.04); padding:0.65rem 0.8rem; border-radius:8px; border:1px solid rgba(255,255,255,0.06);">
                        <span style="color:var(--text-secondary); font-size:0.74rem; display:block;">연간 총 배정 예산</span>
                        <strong style="font-size:1.05rem; color:#38bdf8;">${formatAmount(data.totalBudget)}원</strong>
                        <div style="font-size:0.72rem; color:${burnColor}; margin-top:0.2rem; font-weight:600;">소진율 ${data.totalBurnRate.toFixed(1)}% (잔여 ${formatAmount(data.totalRemaining)}원)</div>
                    </div>
                    <div style="background:rgba(255,255,255,0.04); padding:0.65rem 0.8rem; border-radius:8px; border:1px solid rgba(255,255,255,0.06);">
                        <span style="color:var(--text-secondary); font-size:0.74rem; display:block;">🏢 회사 지원금 (법인)</span>
                        <strong style="font-size:0.95rem; color:#34d399;">${formatAmount(data.totalSupport)}원</strong>
                        <div style="font-size:0.72rem; color:var(--text-secondary); margin-top:0.15rem;">전체의 ${suppRatio}%</div>
                    </div>
                    <div style="background:rgba(255,255,255,0.04); padding:0.65rem 0.8rem; border-radius:8px; border:1px solid rgba(255,255,255,0.06);">
                        <span style="color:var(--text-secondary); font-size:0.74rem; display:block;">👤 임직원 자부담 (개인)</span>
                        <strong style="font-size:0.95rem; color:#f87171;">${formatAmount(data.totalSelfPay)}원</strong>
                        <div style="font-size:0.72rem; color:var(--text-secondary); margin-top:0.15rem;">전체의 ${selfRatio}%</div>
                    </div>
                </div>

                <!-- 소진율 프로그레스 바 -->
                <div style="margin-top:0.75rem;">
                    <div style="display:flex; justify-content:space-between; font-size:0.74rem; color:var(--text-secondary); margin-bottom:0.25rem;">
                        <span>예산 소진 현황</span>
                        <span style="color:${burnColor}; font-weight:600;">${data.totalBurnRate.toFixed(1)}%</span>
                    </div>
                    <div style="width:100%; height:6px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden;">
                        <div style="width:${burnRatePct}%; height:100%; background:${burnColor}; border-radius:3px; transition:width 0.3s ease;"></div>
                    </div>
                </div>

                <div style="margin-top:0.75rem; padding-top:0.6rem; border-top:1px solid rgba(255,255,255,0.08); display:flex; justify-content:space-between; font-size:0.78rem; color:var(--text-secondary);">
                    <span>👥 실참석자: <strong style="color:var(--text-primary);">${data.companyUniqueCount}명</strong> (연인원 ${data.totalAttendeesSum}명)</span>
                    <span>🎁 상품비: <strong style="color:#fbbf24;">${formatAmount(data.prizeSpend)}원</strong> (규정 준수 100%)</span>
                </div>
            `;
        }

        yearSelect.onchange = updatePreview;
        updatePreview();
    }

    function closeYearEndPptModal() {
        const modal = document.getElementById('year-end-ppt-modal');
        if (modal) modal.classList.add('hidden');
    }

    async function handleDownloadYearEndPpt() {
        const yearSelect = document.getElementById('year-end-ppt-year-select');
        const btn = document.getElementById('download-year-end-ppt-btn');
        const btnText = document.getElementById('year-end-ppt-btn-text');
        const btnIcon = document.getElementById('year-end-ppt-btn-icon');
        const selYear = parseInt(yearSelect ? yearSelect.value : new Date().getFullYear(), 10) || new Date().getFullYear();

        if (btn) btn.disabled = true;
        if (btnIcon) btnIcon.textContent = '⏳';
        if (btnText) btnText.textContent = '데이터 분석 중...';

        const updateProgress = (msg) => {
            if (btnText) btnText.textContent = msg;
        };

        try {
            let historyList = B.lastHistoryList;
            if (!historyList || historyList.length === 0) {
                if (firebaseDb) {
                    const [snapshot, deletedSnap] = await Promise.all([
                        firebaseDb.ref('globalHistory').once('value'),
                        firebaseDb.ref('deletedHistoryIds').once('value')
                    ]);
                    const historyData = snapshot.val() || {};
                    const cachedDeletedIds = deletedSnap.val() || {};
                    historyList = (typeof window.extractValidGlobalHistory === 'function'
                        ? window.extractValidGlobalHistory(historyData, cachedDeletedIds, firebaseDb)
                        : Object.values(historyData).filter(e => e && !cachedDeletedIds[String(e.id)])
                    ).sort(compareHistoryEntriesNewestFirst);
                    B.lastHistoryList = historyList;
                }
            }

            const yearClubRegistry = AppState.getClubRegistryForYear(selYear);
            await YearEndPptGenerator.generateAndDownload(selYear, historyList, yearClubRegistry, updateProgress);
            if (btnIcon) btnIcon.textContent = '✅';
            if (btnText) btnText.textContent = '다운로드 완료!';
            setTimeout(() => {
                if (btnIcon) btnIcon.textContent = '📥';
                if (btnText) btnText.textContent = 'PPTX 다운로드';
                if (btn) btn.disabled = false;
                closeYearEndPptModal();
            }, 1200);
        } catch (err) {
            console.error('PPT 다운로드 실패:', err);
            alert(`PPT 다운로드 중 오류가 발생했습니다: ${err.message || err}`);
            if (btnIcon) btnIcon.textContent = '📥';
            if (btnText) btnText.textContent = 'PPTX 다운로드';
            if (btn) btn.disabled = false;
        }
    }

    document.getElementById('admin-export-ppt-btn')?.addEventListener('click', openYearEndPptModal);
    document.getElementById('history-export-ppt-btn')?.addEventListener('click', openYearEndPptModal);
    document.getElementById('close-year-end-ppt-modal')?.addEventListener('click', closeYearEndPptModal);
    document.getElementById('cancel-year-end-ppt-btn')?.addEventListener('click', closeYearEndPptModal);
    document.getElementById('download-year-end-ppt-btn')?.addEventListener('click', handleDownloadYearEndPpt);
    document.getElementById('year-end-ppt-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'year-end-ppt-modal') closeYearEndPptModal();
    });

    // ── 중간 결산 모달 & 엑셀 다운로드 ───────────────────
    const isPinnedInterimBottomClub = (name) => String(name || '').replace(/\s+/g, ' ').trim() === '3M 동탄 운영진';

    function computeInterimTotals(rows, labTotalBudget) {
        const list = Array.isArray(rows) ? rows : [];
        const totalBudget = list.reduce((s, r) => s + (Number(r.budget) || 0), 0);
        const totalSupport = list.reduce((s, r) => s + (Number(r.support) || 0), 0);
        const totalEvents = list.reduce((s, r) => s + (Number(r.eventCount) || 0), 0);
        const totalRegular = list.reduce((s, r) => s + (Number(r.regularMembers) || 0), 0);
        const totalActual = list.reduce((s, r) => s + (Number(r.actualMembers) || 0), 0);
        const totalNonMembers = list.reduce((s, r) => s + (Number(r.nonMembers) || 0), 0);
        const totalAllMembers = totalRegular + totalNonMembers;
        const totalBudgetRatio = list.reduce((s, r) => s + (Number(r.budgetRatio) || 0), 0);
        const totalMemberRatio = list.reduce((s, r) => s + (Number(r.memberRatio) || 0), 0);
        return {
            totals: {
                name: '총합계',
                budget: totalBudget,
                support: totalSupport,
                remaining: totalBudget - totalSupport,
                eventCount: totalEvents,
                regularMembers: totalRegular,
                actualMembers: totalActual,
                nonMembers: totalNonMembers,
                totalMembers: totalAllMembers,
                budgetRatio: totalBudget > 0 ? Math.min(100, totalBudgetRatio) : 0,
                memberRatio: totalAllMembers > 0 ? Math.min(100, totalMemberRatio) : 0,
                burnRate: totalBudget > 0 ? (totalSupport / totalBudget) * 100 : 0,
                perPersonSupport: totalAllMembers > 0 ? Math.round(totalSupport / totalAllMembers) : 0,
                avgParticipants: totalEvents > 0 ? Math.round(totalAllMembers / totalEvents) : 0,
                noteText: ''
            },
            labRemainingBudget: labTotalBudget - totalBudget
        };
    }

    function buildInterimSummaryData(selectedYear, historyList, clubRegistry) {
        const yearStr = String(selectedYear || 'ALL');
        const filteredEntries = (historyList || []).filter(e => {
            if (!e) return false;
            if (yearStr === 'ALL') return true;
            return String(getHistoryEntryYear(e)) === yearStr;
        });

        const clubMap = new Map();
        const seenNames = new Set();
        Object.values(clubRegistry || {}).forEach(club => {
            if (!club) return;
            const name = String(club.name || '').trim();
            const key = name.toLowerCase();
            if (!name || seenNames.has(key)) return;
            seenNames.add(key);
            clubMap.set(key, {
                name,
                budget: Number(club.budget) || 0,
                support: 0,
                eventCount: 0,
                regularMembers: 0,
                actualMembers: 0,
                uniqueAttendeeKeys: new Set(),
                attendeeCountMap: new Map(),
                events: [],
                nonMembers: 0,
                noteCounts: new Map()
            });
        });

        filteredEntries.forEach(entry => {
            const name = String(entry.clubName || '기본 클럽').trim() || '기본 클럽';
            const key = name.toLowerCase();
            if (!clubMap.has(key)) {
                clubMap.set(key, {
                    name,
                    budget: 0,
                    support: 0,
                    eventCount: 0,
                    regularMembers: 0,
                    actualMembers: 0,
                    uniqueAttendeeKeys: new Set(),
                    attendeeCountMap: new Map(),
                    events: [],
                    nonMembers: 0,
                    noteCounts: new Map()
                });
            }
            const row = clubMap.get(key);
            const entrySupport = Math.max(0, parseAmount(entry.finalSupportAmount));
            row.support += entrySupport;
            row.eventCount += 1;
            const regCnt = Number(entry.memberCount) || (Array.isArray(entry.attendees) ? entry.attendees.length : 0);
            const nonCnt = Math.max(0, parseInt(entry.nonMemberCount, 10) || 0);
            row.regularMembers += regCnt;
            row.nonMembers += nonCnt;

            const entryDate = entry.settlementDate || (entry.date ? String(entry.date).slice(0, 10) : '-');
            const note = String(entry.eventNote || '').trim();
            row.events.push({
                date: entryDate,
                memberCount: regCnt,
                support: entrySupport,
                note
            });

            if (Array.isArray(entry.attendees)) {
                const seenInEntry = new Set();
                entry.attendees.forEach(att => {
                    if (!att) return;
                    const empId = (typeof att === 'object' && att.employeeId) ? String(att.employeeId).trim() : '';
                    const attName = (typeof att === 'object' ? (att.name || '') : String(att)).trim();
                    const uKey = empId ? `id:${empId}` : (attName ? `name:${attName}` : '');
                    if (uKey) {
                        row.uniqueAttendeeKeys.add(uKey);
                        if (!seenInEntry.has(uKey)) {
                            seenInEntry.add(uKey);
                            const prevAtt = row.attendeeCountMap.get(uKey);
                            if (prevAtt) {
                                prevAtt.count += 1;
                            } else {
                                row.attendeeCountMap.set(uKey, { name: attName || '이름 없음', empId, count: 1 });
                            }
                        }
                    }
                });
            }

            if (note) {
                row.noteCounts.set(note, (row.noteCounts.get(note) || 0) + 1);
            }
        });

        const rows = Array.from(clubMap.values()).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
        const totalBudget = rows.reduce((s, r) => s + r.budget, 0);
        const totalRegular = rows.reduce((s, r) => s + r.regularMembers, 0);
        const totalNonMembers = rows.reduce((s, r) => s + r.nonMembers, 0);
        const totalAllMembers = totalRegular + totalNonMembers;

        const computedRows = rows.map(r => {
            const totalClubMembers = r.regularMembers + r.nonMembers;
            const actualMembers = r.uniqueAttendeeKeys ? r.uniqueAttendeeKeys.size : 0;
            const remaining = r.budget - r.support;
            const budgetRatio = totalBudget > 0 ? (r.budget / totalBudget) * 100 : 0;
            const memberRatio = totalAllMembers > 0 ? (totalClubMembers / totalAllMembers) * 100 : 0;
            const burnRate = r.budget > 0 ? (r.support / r.budget) * 100 : 0;
            const perPersonSupport = totalClubMembers > 0 ? Math.round(r.support / totalClubMembers) : 0;
            const avgParticipants = r.eventCount > 0 ? Math.round(totalClubMembers / r.eventCount) : 0;
            const noteText = Array.from(r.noteCounts.entries())
                .map(([n, cnt]) => `${n} ${cnt}회`)
                .join(', ');
            const sortedEvents = (r.events || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
            const eventLines = sortedEvents.map((ev, idx) =>
                `${idx + 1}. ${ev.date} | 참석 ${ev.memberCount}명 | 지원 ${formatAmount(ev.support)}원${ev.note ? ` (${ev.note})` : ''}`
            );
            const eventTooltip = eventLines.length > 0
                ? `[${r.name} 정산 내역 (${eventLines.length}건)]\n${eventLines.join('\n')}`
                : `${r.name} 정산 내역 없음`;
            const attList = Array.from((r.attendeeCountMap || new Map()).values())
                .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name, 'ko-KR'));
            const attFormatted = attList.map(a => `${a.name} (${a.count}회)`);
            let attLines = attFormatted;
            if (attFormatted.length > 10) {
                attLines = [];
                for (let i = 0; i < attFormatted.length; i += 2) {
                    attLines.push(attFormatted.slice(i, i + 2).join(' · '));
                }
            }
            const actualMembersTooltip = attLines.length > 0
                ? `[${r.name} 실참석 ${attList.length}명]\n${attLines.join('\n')}`
                : `${r.name} 실참석 내역 없음`;
            return {
                name: r.name,
                budget: r.budget,
                support: r.support,
                eventCount: r.eventCount,
                regularMembers: r.regularMembers,
                actualMembers,
                nonMembers: r.nonMembers,
                remaining,
                totalMembers: totalClubMembers,
                budgetRatio,
                memberRatio,
                burnRate,
                perPersonSupport,
                avgParticipants,
                noteText,
                eventTooltip,
                actualMembersTooltip
            };
        }).sort((a, b) => {
            const aPin = isPinnedInterimBottomClub(a.name);
            const bPin = isPinnedInterimBottomClub(b.name);
            if (aPin !== bPin) return aPin ? 1 : -1;
            const aFull = (a.budget > 0 && a.burnRate >= 99.95) ? 1 : 0;
            const bFull = (b.budget > 0 && b.burnRate >= 99.95) ? 1 : 0;
            if (bFull !== aFull) return bFull - aFull;
            if (Math.abs(b.burnRate - a.burnRate) > 0.001) return b.burnRate - a.burnRate;
            if (b.support !== a.support) return b.support - a.support;
            return a.name.localeCompare(b.name, 'ko');
        });

        const labTotalBudget = yearStr === 'ALL'
            ? Math.max(0, Number(AppState.clubTotalBudget) || 0)
            : Math.max(0, Number(AppState.getClubTotalBudgetForYear(yearStr)) || 0);
        const { totals, labRemainingBudget } = computeInterimTotals(computedRows, labTotalBudget);

        return { year: yearStr, rows: computedRows, totals, labTotalBudget, labRemainingBudget };
    }

    let currentInterimSummaryData = null;
    let _activeInterimFilterPopover = null;
    let _activeInterimFilterCol = null;

    function closeInterimFilterPopover() {
        if (_activeInterimFilterPopover) {
            _activeInterimFilterPopover.remove();
            _activeInterimFilterPopover = null;
        }
        _activeInterimFilterCol = null;
    }

    document.addEventListener('pointerdown', (e) => {
        if (!_activeInterimFilterPopover) return;
        if (_activeInterimFilterPopover.contains(e.target)) return;
        if (e.target.closest && e.target.closest('.interim-th-filterable')) return;
        closeInterimFilterPopover();
    });

    async function openInterimSummaryModal() {
        if (!AppState.hasAdminAccess) return;
        const modal = document.getElementById('interim-summary-modal');
        const yearSelect = document.getElementById('interim-summary-year-select');
        const tableWrap = document.getElementById('interim-summary-table-wrap');
        if (!modal || !yearSelect || !tableWrap) return;

        closeInterimFilterPopover();
        modal.classList.remove('hidden');
        tableWrap.innerHTML = '<div style="padding:2rem; text-align:center; color:var(--text-secondary);">데이터를 집계하는 중입니다...</div>';

        let historyList = B.lastHistoryList;
        if (firebaseDb) {
            try {
                const [snapshot, deletedSnap] = await Promise.all([
                    firebaseDb.ref('globalHistory').once('value'),
                    firebaseDb.ref('deletedHistoryIds').once('value')
                ]);
                const historyData = snapshot.val() || {};
                const delIds = deletedSnap.val() || {};
                historyList = (typeof window.extractValidGlobalHistory === 'function'
                    ? window.extractValidGlobalHistory(historyData, delIds, firebaseDb)
                    : Object.values(historyData).filter(e => e && !delIds[String(e.id)])
                ).sort(compareHistoryEntriesNewestFirst);
                B.lastHistoryList = historyList;
            } catch (e) {
                console.error('중간 결산 이력 로드 실패:', e);
            }
        }

        const years = YearEndPptGenerator.getAvailableYears(historyList);
        const defaultYear = String(_selectedQueryYear || new Date().getFullYear());
        yearSelect.innerHTML = years.map(y => `<option value="${y}" ${String(y) === defaultYear ? 'selected' : ''}>${y}년</option>`).join('') +
            `<option value="ALL" ${defaultYear === 'ALL' ? 'selected' : ''}>전체 연도</option>`;

        const INTERIM_COLS = [
            { key: 'name', label: '클럽명', align: 'left', type: 'text' },
            { key: 'budget', label: '예산', align: 'right', type: 'currency' },
            { key: 'support', label: '지원금', align: 'right', type: 'currency' },
            { key: 'remaining', label: '잔여금액', align: 'right', type: 'currency' },
            { key: 'eventCount', label: '행사수', align: 'right', type: 'number' },
            { key: 'regularMembers', label: '총 참석자', align: 'right', type: 'number' },
            { key: 'actualMembers', label: '실참석', align: 'right', type: 'number' },
            { key: 'nonMembers', label: '비회원', align: 'right', type: 'number' },
            { key: 'budgetRatio', label: '예산 비율', align: 'right', type: 'percent' },
            { key: 'memberRatio', label: '인원 비율', align: 'right', type: 'percent' },
            { key: 'burnRate', label: '소진율', align: 'right', type: 'percent' },
            { key: 'perPersonSupport', label: '인당 지원금', align: 'right', type: 'currency' },
            { key: 'avgParticipants', label: '평균 참여 인원수', align: 'right', type: 'number' },
            { key: 'noteText', label: '비고', align: 'left', type: 'text' }
        ];
        const colDefMap = Object.fromEntries(INTERIM_COLS.map(c => [c.key, c]));

        let interimSortKey = null;
        let interimSortDir = 'asc';
        const interimColFilters = Object.fromEntries(INTERIM_COLS.map(c => [c.key, null]));

        const getInterimColKey = (row, colKey) => {
            const def = colDefMap[colKey];
            if (!def) return '';
            if (def.type === 'percent') return (Number(row[colKey]) || 0).toFixed(1);
            if (def.type === 'currency' || def.type === 'number') return String(Number(row[colKey]) || 0);
            if (colKey === 'noteText') return String(row.noteText || '').trim() || '-';
            return String(row[colKey] || '').trim();
        };

        const getInterimColLabel = (row, colKey) => {
            const def = colDefMap[colKey];
            if (!def) return '';
            if (def.type === 'currency') return SettlementCalculator.formatCurrency(Number(row[colKey]) || 0);
            if (def.type === 'percent') return `${(Number(row[colKey]) || 0).toFixed(1)}%`;
            if (def.type === 'number') return `${Number(row[colKey]) || 0}`;
            if (colKey === 'noteText') return String(row.noteText || '').trim() || '-';
            return String(row[colKey] || '').trim();
        };

        const formatInterimTitle = (selYear) => {
            const now = new Date();
            const curY = now.getFullYear();
            const curM = now.getMonth() + 1;
            const curD = now.getDate();
            if (String(selYear) === 'ALL') {
                return `전체 기간 ~ ${curY}년 ${curM}월 ${curD}일 진행 내역`;
            }
            if (String(selYear) === String(curY)) {
                return `${selYear}년 1월 ~ ${curY}년 ${curM}월 ${curD}일 진행 내역`;
            }
            return `${selYear}년 1월 ~ ${selYear}년 12월 진행 내역`;
        };

        const openInterimFilterPopover = (colKey, anchorEl, allBaseRows) => {
            if (_activeInterimFilterPopover && _activeInterimFilterCol === colKey) {
                closeInterimFilterPopover();
                return;
            }
            closeInterimFilterPopover();
            _activeInterimFilterCol = colKey;

            const def = colDefMap[colKey];
            const isTextCol = def.type === 'text';

            const baseRows = allBaseRows.filter(item => {
                for (const other of INTERIM_COLS) {
                    if (other.key === colKey) continue;
                    const set = interimColFilters[other.key];
                    if (set instanceof Set && !set.has(getInterimColKey(item, other.key))) {
                        return false;
                    }
                }
                return true;
            });
            const sourceRows = baseRows.length > 0 ? baseRows : allBaseRows;

            const valueMap = new Map();
            sourceRows.forEach(row => {
                const key = getInterimColKey(row, colKey);
                const label = getInterimColLabel(row, colKey);
                const numVal = isTextCol ? 0 : (Number(row[colKey]) || 0);
                if (!valueMap.has(key)) {
                    valueMap.set(key, { key, label, numVal, count: 1 });
                } else {
                    valueMap.get(key).count += 1;
                }
            });
            const existingSet = interimColFilters[colKey];
            if (existingSet instanceof Set) {
                allBaseRows.forEach(row => {
                    const key = getInterimColKey(row, colKey);
                    if (existingSet.has(key) && !valueMap.has(key)) {
                        valueMap.set(key, {
                            key,
                            label: getInterimColLabel(row, colKey),
                            numVal: isTextCol ? 0 : (Number(row[colKey]) || 0),
                            count: 0
                        });
                    }
                });
            }

            const uniqueItems = Array.from(valueMap.values()).sort((a, b) => {
                if (isTextCol) return a.label.localeCompare(b.label, 'ko-KR');
                return b.numVal - a.numVal;
            });

            const ascLabel = isTextCol ? '↑ 가나다순 정렬 (오름차순)' : '↑ 낮은순 정렬 (오름차순)';
            const descLabel = isTextCol ? '↓ 가나다 역순 정렬 (내림차순)' : '↓ 높은순 정렬 (내림차순)';

            const popover = document.createElement('div');
            popover.className = 'club-excel-filter-popover';
            popover.style.zIndex = '10400';
            popover.setAttribute('role', 'dialog');
            popover.setAttribute('aria-label', `${def.label} 정렬 및 필터`);

            const isAscActive = interimSortKey === colKey && interimSortDir === 'asc';
            const isDescActive = interimSortKey === colKey && interimSortDir === 'desc';

            popover.innerHTML = `
                <div class="club-excel-filter-section-title">${AppState.escapeHtml(def.label)} 정렬</div>
                <button type="button" class="club-excel-sort-btn ${isDescActive ? 'is-active' : ''}" data-sort-dir="desc">${descLabel}</button>
                <button type="button" class="club-excel-sort-btn ${isAscActive ? 'is-active' : ''}" data-sort-dir="asc">${ascLabel}</button>
                <div class="club-excel-divider"></div>
                <div class="club-excel-filter-section-title">목록 필터 (체크 선택)</div>
                <input type="text" class="club-excel-search-input" placeholder="${isTextCol ? '텍스트 검색...' : '값 검색...'}" autocomplete="off">
                <div class="club-excel-checklist"></div>
                <div class="club-excel-actions">
                    <button type="button" class="btn-secondary club-excel-clear-btn">전체 해제/초기화</button>
                    <button type="button" class="btn-primary-sm club-excel-apply-btn">확인</button>
                </div>
            `;

            const checklistEl = popover.querySelector('.club-excel-checklist');
            const searchInputEl = popover.querySelector('.club-excel-search-input');
            const selectedKeys = new Set(
                existingSet instanceof Set ? Array.from(existingSet) : uniqueItems.map(it => it.key)
            );

            function renderChecklist(keyword = '') {
                const kw = keyword.trim().toLowerCase();
                const visibleItems = kw
                    ? uniqueItems.filter(it => it.label.toLowerCase().includes(kw) || it.key.toLowerCase().includes(kw))
                    : uniqueItems;
                const frag = document.createDocumentFragment();

                const allRow = document.createElement('label');
                allRow.className = 'club-excel-check-item select-all-row';
                const allChecked = visibleItems.length > 0 && visibleItems.every(it => selectedKeys.has(it.key));
                const someChecked = visibleItems.some(it => selectedKeys.has(it.key));
                allRow.innerHTML = `
                    <input type="checkbox" class="club-excel-check-all" ${allChecked ? 'checked' : ''}>
                    <span class="club-excel-check-label">(전체 선택)</span>
                    <span class="club-excel-check-count">${visibleItems.length}개</span>
                `;
                const allCheckbox = allRow.querySelector('.club-excel-check-all');
                if (allCheckbox && !allChecked && someChecked) {
                    allCheckbox.indeterminate = true;
                }
                allCheckbox.addEventListener('change', () => {
                    if (allCheckbox.checked) visibleItems.forEach(it => selectedKeys.add(it.key));
                    else visibleItems.forEach(it => selectedKeys.delete(it.key));
                    renderChecklist(searchInputEl.value);
                });
                frag.appendChild(allRow);

                visibleItems.forEach(it => {
                    const itemLabel = document.createElement('label');
                    itemLabel.className = 'club-excel-check-item';
                    const checked = selectedKeys.has(it.key);
                    itemLabel.innerHTML = `
                        <input type="checkbox" class="club-excel-check-val" data-val-key="${AppState.escapeHtml(it.key)}" ${checked ? 'checked' : ''}>
                        <span class="club-excel-check-label" title="${AppState.escapeHtml(it.label)}">${AppState.escapeHtml(it.label)}</span>
                        ${it.count > 1 ? `<span class="club-excel-check-count">(${it.count})</span>` : ''}
                    `;
                    const cb = itemLabel.querySelector('.club-excel-check-val');
                    cb.addEventListener('change', () => {
                        if (cb.checked) selectedKeys.add(it.key);
                        else selectedKeys.delete(it.key);
                        const nowAll = visibleItems.length > 0 && visibleItems.every(v => selectedKeys.has(v.key));
                        const nowSome = visibleItems.some(v => selectedKeys.has(v.key));
                        allCheckbox.checked = nowAll;
                        allCheckbox.indeterminate = !nowAll && nowSome;
                    });
                    frag.appendChild(itemLabel);
                });
                checklistEl.replaceChildren(frag);
            }

            renderChecklist('');
            searchInputEl.addEventListener('input', () => renderChecklist(searchInputEl.value));

            popover.querySelectorAll('.club-excel-sort-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    interimSortKey = colKey;
                    interimSortDir = btn.getAttribute('data-sort-dir') === 'desc' ? 'desc' : 'asc';
                    closeInterimFilterPopover();
                    renderTable();
                });
            });

            popover.querySelector('.club-excel-clear-btn').addEventListener('click', () => {
                interimColFilters[colKey] = null;
                closeInterimFilterPopover();
                renderTable();
            });

            popover.querySelector('.club-excel-apply-btn').addEventListener('click', () => {
                if (selectedKeys.size === 0 || selectedKeys.size >= uniqueItems.length) {
                    interimColFilters[colKey] = selectedKeys.size === 0 ? new Set() : null;
                } else {
                    interimColFilters[colKey] = new Set(selectedKeys);
                }
                closeInterimFilterPopover();
                renderTable();
            });

            document.body.appendChild(popover);
            const rect = anchorEl.getBoundingClientRect();
            const popRect = popover.getBoundingClientRect();
            let left = rect.left;
            if (left + popRect.width > window.innerWidth - 12) {
                left = Math.max(12, window.innerWidth - popRect.width - 12);
            }
            let top = rect.bottom + 6;
            if (top + popRect.height > window.innerHeight - 12) {
                top = Math.max(12, rect.top - popRect.height - 6);
            }
            popover.style.left = `${left}px`;
            popover.style.top = `${top}px`;
            _activeInterimFilterPopover = popover;
        };

        const renderTable = () => {
            const selYear = yearSelect.value || defaultYear;
            const titleText = formatInterimTitle(selYear);
            const titleEl = document.getElementById('interim-summary-modal-title');
            if (titleEl) titleEl.textContent = `📋 ${titleText}`;

            const targetClubRegistry = selYear === 'ALL' ? AppState.clubRegistry : AppState.getClubRegistryForYear(selYear);
            const baseSummary = buildInterimSummaryData(selYear, historyList, targetClubRegistry);
            const baseRows = baseSummary.rows;

            // 엑셀형 필터 적용
            const filteredRows = baseRows.filter(item => {
                for (const col of INTERIM_COLS) {
                    const set = interimColFilters[col.key];
                    if (set instanceof Set && !set.has(getInterimColKey(item, col.key))) {
                        return false;
                    }
                }
                return true;
            });

            // 정렬 적용 (단, 3M 동탄 운영진은 정렬/필터 여부와 무관하게 항상 맨 아래 고정)
            const sortedRows = filteredRows.slice();
            if (interimSortKey) {
                const def = colDefMap[interimSortKey];
                const dirFactor = interimSortDir === 'desc' ? -1 : 1;
                sortedRows.sort((a, b) => {
                    const aPin = isPinnedInterimBottomClub(a.name);
                    const bPin = isPinnedInterimBottomClub(b.name);
                    if (aPin !== bPin) return aPin ? 1 : -1;
                    let cmp = 0;
                    if (def && def.type === 'text') {
                        cmp = String(a[interimSortKey] || '').localeCompare(String(b[interimSortKey] || ''), 'ko-KR');
                    } else {
                        cmp = (Number(a[interimSortKey]) || 0) - (Number(b[interimSortKey]) || 0);
                    }
                    if (cmp !== 0) return cmp * dirFactor;
                    return a.name.localeCompare(b.name, 'ko-KR');
                });
            }

            const { totals: filteredTotals, labRemainingBudget } = computeInterimTotals(sortedRows, baseSummary.labTotalBudget);
            currentInterimSummaryData = {
                year: baseSummary.year,
                titleText,
                rows: sortedRows,
                totals: filteredTotals,
                labTotalBudget: baseSummary.labTotalBudget,
                labRemainingBudget
            };

            const isLight = document.documentElement.getAttribute('data-app-theme') === 'light';
            const thStyle = `padding:0.5rem 0.55rem; font-size:0.78rem; font-weight:700; white-space:nowrap; border-bottom:2px solid var(--card-border); background:${isLight ? '#e2e8f0' : 'rgba(15,23,42,0.92)'}; color:var(--text-primary); position:sticky; top:0; z-index:2; cursor:pointer; user-select:none;`;
            const tdBase = `padding:0.42rem 0.55rem; font-size:0.8rem; border-bottom:1px solid var(--card-border); white-space:nowrap;`;

            const bodyHtml = sortedRows.length > 0
                ? sortedRows.map(r => {
                    const isExhausted = r.budget > 0 && r.burnRate >= 99.95;
                    const rowHighlight = isExhausted
                        ? (isLight ? 'background:rgba(250,204,21,0.22);' : 'background:rgba(250,204,21,0.12);')
                        : '';
                    const burnBg = isExhausted
                        ? (isLight ? 'background:#15803d; color:#ffffff; font-weight:700;' : 'background:rgba(22,163,74,0.85); color:#ffffff; font-weight:700;')
                        : '';
                    const remColor = r.remaining < 0
                        ? (isLight ? 'color:#dc2626; font-weight:700;' : 'color:#f87171; font-weight:700;')
                        : (r.remaining === 0 ? 'color:var(--text-muted);' : (isLight ? 'color:#1e40af; font-weight:600;' : 'color:#93c5fd; font-weight:600;'));
                    return `
                        <tr style="${rowHighlight}">
                            <td style="${tdBase} font-weight:700; text-align:left;">${AppState.escapeHtml(r.name)}</td>
                            <td style="${tdBase} text-align:right;">${formatAmount(r.budget)}</td>
                            <td style="${tdBase} text-align:right;">${formatAmount(r.support)}</td>
                            <td style="${tdBase} text-align:right; ${remColor}">${formatAmount(r.remaining)}</td>
                            <td style="${tdBase} text-align:right; cursor:help; text-decoration:underline dotted; text-underline-offset:3px;" data-tooltip="${AppState.escapeHtml(r.eventTooltip || '')}" tabindex="0">${r.eventCount}</td>
                            <td style="${tdBase} text-align:right;">${r.regularMembers}</td>
                            <td style="${tdBase} text-align:right; font-weight:600; color:var(--color-primary); cursor:help; text-decoration:underline dotted; text-underline-offset:3px;" data-tooltip="${AppState.escapeHtml(r.actualMembersTooltip || '')}" tabindex="0">${r.actualMembers}</td>
                            <td style="${tdBase} text-align:right;">${r.nonMembers}</td>
                            <td style="${tdBase} text-align:right;">${r.budgetRatio.toFixed(1)}%</td>
                            <td style="${tdBase} text-align:right;">${r.memberRatio.toFixed(1)}%</td>
                            <td style="${tdBase} text-align:right; ${burnBg}">${r.burnRate.toFixed(1)}%</td>
                            <td style="${tdBase} text-align:right;">${formatAmount(r.perPersonSupport)}</td>
                            <td style="${tdBase} text-align:right;">${r.avgParticipants}</td>
                            <td style="${tdBase} text-align:left; color:${r.noteText ? 'var(--color-secondary)' : 'var(--text-muted)'}; font-weight:${r.noteText ? '600' : '400'};">${AppState.escapeHtml(r.noteText || '-')}</td>
                        </tr>
                    `;
                }).join('')
                : `<tr><td colspan="14" style="padding:1.8rem 1rem; text-align:center; color:var(--text-secondary);">선택한 필터 조건에 일치하는 클럽이 없습니다. <button type="button" id="interim-reset-all-filters-btn" class="btn-secondary" style="margin-left:0.5rem; padding:0.25rem 0.65rem; font-size:0.76rem;">필터 모두 해제</button></td></tr>`;

            const t = filteredTotals;
            const totalRowBg = isLight ? 'background:#e2e8f0; color:#0f172a;' : 'background:rgba(30,41,59,0.95); color:#f8fafc;';
            const labRowBg = isLight ? 'background:#fef9c3; color:#0f172a;' : 'background:rgba(234,179,8,0.14); color:#fef08a;';
            const labBalColor = labRemainingBudget < 0
                ? (isLight ? 'color:#dc2626;' : 'color:#f87171;')
                : (isLight ? 'color:#1e40af;' : 'color:#93c5fd;');
            const footHtml = `
                <tr style="${totalRowBg} font-weight:800;">
                    <td style="${tdBase} text-align:left; border-top:2px solid var(--card-border);">${t.name}</td>
                    <td style="${tdBase} text-align:right; border-top:2px solid var(--card-border);">${formatAmount(t.budget)}</td>
                    <td style="${tdBase} text-align:right; border-top:2px solid var(--card-border);">${formatAmount(t.support)}</td>
                    <td style="${tdBase} text-align:right; border-top:2px solid var(--card-border);">${formatAmount(t.remaining)}</td>
                    <td style="${tdBase} text-align:right; border-top:2px solid var(--card-border);">${t.eventCount}</td>
                    <td style="${tdBase} text-align:right; border-top:2px solid var(--card-border);">${t.regularMembers}</td>
                    <td style="${tdBase} text-align:right; border-top:2px solid var(--card-border); color:var(--color-primary);">${t.actualMembers}</td>
                    <td style="${tdBase} text-align:right; border-top:2px solid var(--card-border);">${t.nonMembers}</td>
                    <td style="${tdBase} text-align:right; border-top:2px solid var(--card-border);">${t.budgetRatio.toFixed(1)}%</td>
                    <td style="${tdBase} text-align:right; border-top:2px solid var(--card-border);">${t.memberRatio.toFixed(1)}%</td>
                    <td style="${tdBase} text-align:right; border-top:2px solid var(--card-border);">${t.burnRate.toFixed(1)}%</td>
                    <td style="${tdBase} text-align:right; border-top:2px solid var(--card-border);">${formatAmount(t.perPersonSupport)}</td>
                    <td style="${tdBase} text-align:right; border-top:2px solid var(--card-border);">${t.avgParticipants}</td>
                    <td style="${tdBase} text-align:left; border-top:2px solid var(--card-border);"></td>
                </tr>
                <tr style="${labRowBg} font-weight:800;">
                    <td style="${tdBase} text-align:left; border-top:1px solid var(--card-border);">연구소 총 예산</td>
                    <td style="${tdBase} text-align:right; border-top:1px solid var(--card-border);">${formatAmount(baseSummary.labTotalBudget)}</td>
                    <td colspan="12" style="${tdBase} text-align:left; border-top:1px solid var(--card-border); font-weight:500; font-size:0.74rem; color:var(--text-secondary);"></td>
                </tr>
                <tr style="${labRowBg} font-weight:800;">
                    <td style="${tdBase} text-align:left; border-top:1px solid var(--card-border);">연구소 예산 잔액</td>
                    <td style="${tdBase} text-align:right; border-top:1px solid var(--card-border); ${labBalColor}">${formatAmount(labRemainingBudget)}</td>
                    <td colspan="12" style="${tdBase} text-align:left; border-top:1px solid var(--card-border);"></td>
                </tr>
            `;

            const headHtml = INTERIM_COLS.map(col => {
                const isFiltered = interimColFilters[col.key] instanceof Set;
                const isSorted = interimSortKey === col.key;
                const arrow = isSorted ? (interimSortDir === 'desc' ? '▼' : '▲') : (isFiltered ? '⏷' : '▾');
                const activeStyle = (isFiltered || isSorted) ? 'color:var(--color-primary);' : 'opacity:0.65;';
                return `<th class="interim-th-filterable ${isFiltered || isSorted ? 'is-filtered' : ''}" data-interim-col="${col.key}" style="${thStyle} text-align:${col.align};" title="클릭하여 정렬/필터">${col.label} <span class="club-th-arrow" style="font-size:0.68rem; margin-left:2px; ${activeStyle}">${arrow}</span></th>`;
            }).join('');

            tableWrap.innerHTML = `
                <table style="width:100%; border-collapse:collapse; min-width:1020px;">
                    <thead>
                        <tr>${headHtml}</tr>
                    </thead>
                    <tbody>${bodyHtml}</tbody>
                    <tfoot>${footHtml}</tfoot>
                </table>
            `;

            tableWrap.querySelectorAll('.interim-th-filterable').forEach(th => {
                th.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const colKey = th.getAttribute('data-interim-col');
                    if (colKey) openInterimFilterPopover(colKey, th, baseRows);
                });
            });

            const resetAllBtn = document.getElementById('interim-reset-all-filters-btn');
            if (resetAllBtn) {
                resetAllBtn.addEventListener('click', () => {
                    INTERIM_COLS.forEach(c => { interimColFilters[c.key] = null; });
                    interimSortKey = null;
                    renderTable();
                });
            }
        };

        yearSelect.onchange = () => {
            INTERIM_COLS.forEach(c => { interimColFilters[c.key] = null; });
            interimSortKey = null;
            closeInterimFilterPopover();
            renderTable();
        };
        renderTable();
    }

    function closeInterimSummaryModal() {
        closeInterimFilterPopover();
        document.getElementById('interim-summary-modal')?.classList.add('hidden');
    }

    async function downloadInterimSummaryExcel() {
        if (!currentInterimSummaryData || typeof XLSX === 'undefined') {
            alert('엑셀 라이브러리가 준비되지 않았습니다.');
            return;
        }
        const { year, titleText, rows, totals, labTotalBudget, labRemainingBudget } = currentInterimSummaryData;
        const headers = ['클럽명', '예산', '지원금', '잔여금액', '행사수', '총 참석자', '실참석', '비회원', '예산 비율(%)', '인원 비율(%)', '소진율(%)', '인당 지원금', '평균 참여 인원수', '비고'];
        const aoa = [
            [titleText || `${year}년 진행 내역`],
            [],
            headers
        ];
        rows.forEach(r => {
            aoa.push([
                r.name,
                r.budget,
                r.support,
                r.remaining,
                r.eventCount,
                r.regularMembers,
                r.actualMembers || 0,
                r.nonMembers,
                Number(r.budgetRatio.toFixed(1)),
                Number(r.memberRatio.toFixed(1)),
                Number(r.burnRate.toFixed(1)),
                r.perPersonSupport,
                r.avgParticipants,
                r.noteText || ''
            ]);
        });
        aoa.push([
            totals.name,
            totals.budget,
            totals.support,
            totals.remaining,
            totals.eventCount,
            totals.regularMembers,
            totals.actualMembers || 0,
            totals.nonMembers,
            Number(totals.budgetRatio.toFixed(1)),
            Number(totals.memberRatio.toFixed(1)),
            Number(totals.burnRate.toFixed(1)),
            totals.perPersonSupport,
            totals.avgParticipants,
            ''
        ]);
        aoa.push(['연구소 총 예산', labTotalBudget, '', '', '', '', '', '', '', '', '', '', '', '']);
        aoa.push(['연구소 예산 잔액', labRemainingBudget, '', '', '', '', '', '', '', '', '', '', '', '']);

        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = [
            { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 9 },
            { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 13 }, { wch: 13 },
            { wch: 11 }, { wch: 13 }, { wch: 17 }, { wch: 24 }
        ];
        const totalRow1 = 4 + rows.length;
        const labTotalRow1 = totalRow1 + 1;
        const labRemainRow1 = totalRow1 + 2;
        ws['!merges'] = [
            { s: { r: 0, c: 0 }, e: { r: 0, c: 13 } },
            { s: { r: labTotalRow1 - 1, c: 1 }, e: { r: labTotalRow1 - 1, c: 13 } },
            { s: { r: labRemainRow1 - 1, c: 1 }, e: { r: labRemainRow1 - 1, c: 13 } }
        ];
        ws['!rows'] = [
            { hpt: 28 },
            { hpt: 8 },
            { hpt: 24 },
            ...rows.map(() => ({ hpt: 21 })),
            { hpt: 23 },
            { hpt: 22 },
            { hpt: 22 }
        ];

        const wb = XLSX.utils.book_new();
        const sheetName = year === 'ALL' ? '전체_중간결산' : `${year}년_중간결산`;
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
        const fileName = year === 'ALL' ? '중간_결산_전체.xlsx' : `중간_결산_${year}년.xlsx`;

        if (typeof JSZip === 'undefined') {
            XLSX.writeFile(wb, fileName);
            return;
        }

        try {
            const rawBytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
            const zip = await JSZip.loadAsync(rawBytes);

            // 테마 스타일 XML 생성 (타이틀, 헤더, 100% 소진 강조, 소진율 100% 녹색 배지, 총합계, 연구소 예산 행)
            const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="3">
    <numFmt numFmtId="164" formatCode="#,##0"/>
    <numFmt numFmtId="165" formatCode="0.0&quot;%&quot;"/>
    <numFmt numFmtId="166" formatCode="0.0&quot;%&quot;"/>
  </numFmts>
  <fonts count="10">
    <font><sz val="10"/><color rgb="FF0F172A"/><name val="맑은 고딕"/></font>
    <font><b/><sz val="13"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/></font>
    <font><b/><sz val="10"/><color rgb="FF0F172A"/><name val="맑은 고딕"/></font>
    <font><b/><sz val="10"/><color rgb="FF1E40AF"/><name val="맑은 고딕"/></font>
    <font><b/><sz val="10"/><color rgb="FFDC2626"/><name val="맑은 고딕"/></font>
    <font><sz val="10"/><color rgb="FF64748B"/><name val="맑은 고딕"/></font>
    <font><b/><sz val="10"/><color rgb="FF4F46E5"/><name val="맑은 고딕"/></font>
    <font><sz val="10"/><color rgb="FF1E40AF"/><name val="맑은 고딕"/></font>
    <font><b/><sz val="10"/><color rgb="FF1E40AF"/><name val="맑은 고딕"/></font>
  </fonts>
  <fills count="7">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E293B"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF334155"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFEF3C7"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF15803D"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFEF9C3"/></patternFill></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFCBD5E1"/></left>
      <right style="thin"><color rgb="FFCBD5E1"/></right>
      <top style="thin"><color rgb="FFCBD5E1"/></top>
      <bottom style="thin"><color rgb="FFCBD5E1"/></bottom>
      <diagonal/>
    </border>
    <border>
      <left style="thin"><color rgb="FF94A3B8"/></left>
      <right style="thin"><color rgb="FF94A3B8"/></right>
      <top style="medium"><color rgb="FF475569"/></top>
      <bottom style="thin"><color rgb="FF94A3B8"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="28">
    <!-- 0: 기본 -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <!-- 1: 타이틀 (A1:M1) -->
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <!-- 2: 테이블 헤더 좌측 -->
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <!-- 3: 테이블 헤더 우측/중앙 -->
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <!-- 4: 일반 클럽명 (흰 배경, bold) -->
    <xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <!-- 5: 일반 클럽명 (줄무늬 #F8FAFC, bold) -->
    <xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <!-- 6: 일반 숫자 #,##0 (흰 배경) -->
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <!-- 7: 일반 숫자 #,##0 (줄무늬) -->
    <xf numFmtId="164" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <!-- 8: 일반 비율 0.0% (흰 배경) -->
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <!-- 9: 일반 비율 0.0% (줄무늬) -->
    <xf numFmtId="165" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <!-- 10: 일반 소진율 0% (흰 배경) -->
    <xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <!-- 11: 일반 소진율 0% (줄무늬) -->
    <xf numFmtId="166" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <!-- 12: 잔여금액 양수 (파란색, 흰 배경) -->
    <xf numFmtId="164" fontId="8" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <!-- 13: 잔여금액 양수 (파란색, 줄무늬) -->
    <xf numFmtId="164" fontId="8" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <!-- 14: 잔여금액 음수 (빨간색 bold, 흰 배경) -->
    <xf numFmtId="164" fontId="5" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <!-- 15: 100% 소진 행 클럽명 (노란 강조 배경, bold) -->
    <xf numFmtId="0" fontId="3" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <!-- 16: 100% 소진 행 숫자 #,##0 (노란 강조 배경) -->
    <xf numFmtId="164" fontId="0" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <!-- 17: 100% 소진 행 비율 0.0% (노란 강조 배경) -->
    <xf numFmtId="165" fontId="0" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <!-- 18: 100% 소진율 배지 셀 (진녹색 배경, 흰 bold) -->
    <xf numFmtId="166" fontId="2" fillId="6" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <!-- 19: 비고 텍스트 (흰 배경) -->
    <xf numFmtId="0" fontId="7" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <!-- 20: 비고 텍스트 (줄무늬) -->
    <xf numFmtId="0" fontId="7" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <!-- 21: 비고 텍스트 (100% 소진 노란 배경) -->
    <xf numFmtId="0" fontId="7" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <!-- 22: 총합계 텍스트 (회색 배경, 상단 굵은 테두리) -->
    <xf numFmtId="0" fontId="3" fillId="7" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <!-- 23: 총합계 숫자 #,##0 -->
    <xf numFmtId="164" fontId="3" fillId="7" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <!-- 24: 총합계 비율 0.0% -->
    <xf numFmtId="165" fontId="3" fillId="7" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <!-- 25: 총합계 소진율 0% -->
    <xf numFmtId="166" fontId="3" fillId="7" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <!-- 26: 연구소 예산 행 라벨/빈셀 (연노랑 배경) -->
    <xf numFmtId="0" fontId="3" fillId="8" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <!-- 27: 연구소 예산 행 금액 (연노랑 배경, bold 파랑) -->
    <xf numFmtId="164" fontId="4" fillId="8" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
            // fills count 속성 정확히 9개로 보정
            const fixedStylesXml = stylesXml.replace('<fills count="7">', '<fills count="9">');
            zip.file('xl/styles.xml', fixedStylesXml);

            // 행/열별 스타일 인덱스 매핑 (A~N, 14열)
            const cols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'];
            const styleMap = new Map();
            cols.forEach(c => styleMap.set(`${c}1`, 1));
            cols.forEach((c, idx) => styleMap.set(`${c}3`, (idx === 0 || idx === 13) ? 2 : 3));

            rows.forEach((r, i) => {
                const rowNum = 4 + i;
                const isExhausted = r.budget > 0 && r.burnRate >= 99.95;
                const zebra = i % 2 === 1;
                if (isExhausted) {
                    cols.forEach((c, idx) => {
                        let s = 16;
                        if (idx === 0) s = 15;
                        else if (idx === 8 || idx === 9) s = 17;
                        else if (idx === 10) s = 18; // 100% 소진율 진녹색 배지
                        else if (idx === 13) s = 21;
                        styleMap.set(`${c}${rowNum}`, s);
                    });
                } else {
                    cols.forEach((c, idx) => {
                        let s = zebra ? 7 : 6;
                        if (idx === 0) s = zebra ? 5 : 4;
                        else if (idx === 3) {
                            s = r.remaining < 0 ? 14 : (r.remaining > 0 ? (zebra ? 13 : 12) : (zebra ? 7 : 6));
                        } else if (idx === 8 || idx === 9) s = zebra ? 9 : 8;
                        else if (idx === 10) s = zebra ? 11 : 10;
                        else if (idx === 13) s = zebra ? 20 : 19;
                        styleMap.set(`${c}${rowNum}`, s);
                    });
                }
            });

            cols.forEach((c, idx) => {
                let s = 23;
                if (idx === 0 || idx === 13) s = 22;
                else if (idx === 8 || idx === 9) s = 24;
                else if (idx === 10) s = 25;
                styleMap.set(`${c}${totalRow1}`, s);
            });
            cols.forEach((c, idx) => {
                styleMap.set(`${c}${labTotalRow1}`, idx === 1 ? 23 : 26);
                styleMap.set(`${c}${labRemainRow1}`, idx === 1 ? 27 : 26);
            });
            // 연구소 총 예산 금액은 검정 bold(23) 대신 연노랑 배경(#FEF9C3) 위 검정 bold를 위해 27(파랑) vs 16(노랑검정) 구분
            styleMap.set(`B${labTotalRow1}`, 16);
            if (labRemainingBudget < 0) styleMap.set(`B${labRemainRow1}`, 14);

            let sheet1 = await zip.file('xl/worksheets/sheet1.xml').async('string');
            sheet1 = sheet1.replace(/<c r="([A-Z]+\d+)"([^>]*)>/g, (full, ref, attrs) => {
                const sIdx = styleMap.get(ref);
                if (sIdx === undefined) return full;
                const cleanAttrs = attrs.replace(/\s*s="\d+"/, '');
                return `<c r="${ref}" s="${sIdx}"${cleanAttrs}>`;
            });
            zip.file('xl/worksheets/sheet1.xml', sheet1);

            const styledBlob = await zip.generateAsync({
                type: 'blob',
                mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            });
            const url = URL.createObjectURL(styledBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (err) {
            console.warn('스타일 적용 엑셀 생성 실패, 기본 다운로드로 폴백:', err);
            XLSX.writeFile(wb, fileName);
        }
    }

    document.getElementById('admin-interim-summary-btn')?.addEventListener('click', openInterimSummaryModal);
    document.getElementById('close-interim-summary-modal')?.addEventListener('click', closeInterimSummaryModal);
    document.getElementById('download-interim-excel-btn')?.addEventListener('click', downloadInterimSummaryExcel);
    document.getElementById('interim-summary-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'interim-summary-modal') closeInterimSummaryModal();
    });

    // app.js 클로저 외부 참조용 전역 노출 (ESC 키 핸들러 등)
    window.closeYearEndPptModal = closeYearEndPptModal;
    window.openYearEndPptModal = openYearEndPptModal;
    window.openInterimSummaryModal = openInterimSummaryModal;
    window.closeInterimSummaryModal = closeInterimSummaryModal;
    window.YearEndPptGenerator = YearEndPptGenerator;
};
