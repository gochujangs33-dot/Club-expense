const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
    const outDir = path.join(__dirname, 'ppt_screenshots');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle' });

    // 1. 로그인 모달 화면
    const loginCard = await page.$('.pin-modal-card');
    if (loginCard) {
        await loginCard.screenshot({ path: path.join(outDir, '01_login_pin.png') });
        console.log('Saved 01_login_pin.png');
    }

    // 2. 회원 등록 화면으로 전환
    const goRegisterBtn = await page.$('#go-to-register');
    if (goRegisterBtn) {
        await goRegisterBtn.click();
        await page.waitForTimeout(300);
        const regCard = await page.$('.pin-modal-card');
        if (regCard) {
            await regCard.screenshot({ path: path.join(outDir, '02_register.png') });
            console.log('Saved 02_register.png');
        }
        const backLoginBtn = await page.$('#go-to-login');
        if (backLoginBtn) await backLoginBtn.click();
        await page.waitForTimeout(300);
    }

    // 3. 관리자(000000) PIN 로그인 실행
    for (let i = 0; i < 6; i++) {
        await page.click('button.pin-key[data-value="0"]');
        await page.waitForTimeout(60);
    }
    await page.waitForTimeout(800);

    // 4. 최상단 헤더 영역
    const headerEl = await page.$('header.app-header');
    if (headerEl) {
        await headerEl.screenshot({ path: path.join(outDir, '03_header_theme.png') });
        console.log('Saved 03_header_theme.png');
    }

    // 5. 비용 정산 탭 클릭
    const settleTabBtn = await page.$('#settlement-tab-btn');
    if (settleTabBtn) {
        await settleTabBtn.click();
        await page.waitForTimeout(800);
    }

    // 클럽 선택 (보이는 상태일 때)
    try {
        const clubSelect = await page.$('#club-name-select');
        if (clubSelect && await clubSelect.isVisible()) {
            const options = await page.$$eval('#club-name-select option', opts => opts.map(o => o.value).filter(v => v && v !== '__new__'));
            if (options.length > 0) {
                await clubSelect.selectOption(options[0]);
                await page.waitForTimeout(600);
            }
        }
    } catch (_) {}

    // 5-1. 비용 정산 탭 전체 화면
    await page.screenshot({ path: path.join(outDir, '04_settlement_tab.png'), clip: { x: 40, y: 150, width: 1360, height: 740 } });
    console.log('Saved 04_settlement_tab.png');

    // 5-2. 비용 항목 추가 폼
    const expenseForm = await page.$('#expense-form');
    if (expenseForm) {
        await expenseForm.screenshot({ path: path.join(outDir, '05_expense_form.png') });
        console.log('Saved 05_expense_form.png');
    }

    // 5-3. 자동 정산 결과 패널
    const resultPanel = await page.$('#calc-result-panel, .settlement-summary-container');
    if (resultPanel) {
        await resultPanel.screenshot({ path: path.join(outDir, '06_settlement_result.png') });
        console.log('Saved 06_settlement_result.png');
    }

    // 6. 전사원 명부 탭
    const dirTabBtn = await page.$('#directory-tab-btn');
    if (dirTabBtn) {
        await dirTabBtn.click();
        await page.waitForTimeout(800);
        await page.screenshot({ path: path.join(outDir, '07_directory_tab.png'), clip: { x: 40, y: 150, width: 1360, height: 740 } });
        console.log('Saved 07_directory_tab.png');
    }

    // 7. 정산 이력 탭
    const historyTabBtn = await page.$('#history-tab-btn');
    if (historyTabBtn) {
        await historyTabBtn.click();
        await page.waitForTimeout(800);
        await page.screenshot({ path: path.join(outDir, '08_history_tab.png'), clip: { x: 40, y: 150, width: 1360, height: 740 } });
        console.log('Saved 08_history_tab.png');
    }

    // 8. [관리자] 클럽별 정산이력 탭
    const clubHistBtn = await page.$('#club-history-tab-btn');
    if (clubHistBtn) {
        await clubHistBtn.click();
        await page.waitForTimeout(800);
        await page.screenshot({ path: path.join(outDir, '09_club_history_tab.png'), clip: { x: 40, y: 150, width: 1360, height: 740 } });
        console.log('Saved 09_club_history_tab.png');
    }

    // 9. [관리자] 차트 탭
    const chartsTabBtn = await page.$('#charts-tab-btn');
    if (chartsTabBtn) {
        await chartsTabBtn.click();
        await page.waitForTimeout(1200);
        await page.screenshot({ path: path.join(outDir, '10_charts_tab.png'), clip: { x: 40, y: 150, width: 1360, height: 740 } });
        console.log('Saved 10_charts_tab.png');
    }

    // 10. [관리자] 대시보드 관리 탭
    const adminTabBtn = await page.$('#admin-tab-btn');
    if (adminTabBtn) {
        await adminTabBtn.click();
        await page.waitForTimeout(1000);
        await page.screenshot({ path: path.join(outDir, '11_admin_dashboard.png'), clip: { x: 40, y: 150, width: 1360, height: 740 } });
        console.log('Saved 11_admin_dashboard.png');

        // 11. 연간 결산 PPT 모달 열기 및 캡처
        const pptBtn = await page.$('#admin-export-ppt-btn');
        if (pptBtn) {
            await pptBtn.click();
            await page.waitForTimeout(800);
            const pptModalCard = await page.$('#year-end-ppt-modal .modal-content-card');
            if (pptModalCard) {
                await pptModalCard.screenshot({ path: path.join(outDir, '12_ppt_modal.png') });
                console.log('Saved 12_ppt_modal.png');
            }
        }
    }

    await browser.close();
    console.log('ALL SCREENSHOTS CAPTURED SUCCESSFULLY!');
})();
