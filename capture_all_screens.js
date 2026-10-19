const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
    const outDir = path.join(__dirname, 'ppt_screenshots');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const browser = await chromium.launch();

    // ==========================================
    // 세션 1: 일반 회원 (002531)
    // ==========================================
    console.log('--- Starting Session 1: Member ---');
    const memberContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page1 = await memberContext.newPage();
    await page1.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle' });
    await page1.evaluate(() => {
        try {
            localStorage.setItem('club_expense_admin_theme', 'light');
            document.documentElement.dataset.appTheme = 'light';
            document.querySelectorAll('.admin-themed-pane').forEach(p => p.dataset.adminTheme = 'light');
        } catch (_) {}
    });
    await page1.waitForTimeout(500);

    // 1. 로그인 PIN 키패드 모달
    const loginCard = await page1.$('.pin-modal-card');
    if (loginCard) {
        await loginCard.screenshot({ path: path.join(outDir, '01_login_pin.png') });
        console.log('Saved 01_login_pin.png');
    }

    // 2. 회원 등록 화면으로 전환
    const goRegisterBtn = await page1.$('#go-to-register');
    if (goRegisterBtn) {
        await goRegisterBtn.click();
        await page1.waitForTimeout(300);
        const regCard = await page1.$('.pin-modal-card');
        if (regCard) {
            await regCard.screenshot({ path: path.join(outDir, '02_register.png') });
            console.log('Saved 02_register.png');
        }
        const backLoginBtn = await page1.$('#go-to-login');
        if (backLoginBtn) await backLoginBtn.click();
        await page1.waitForTimeout(300);
    }

    // 3. 일반 회원 PIN (002531) 로그인
    const pinDigits = ['0', '0', '2', '5', '3', '1'];
    for (const d of pinDigits) {
        await page1.click(`button.pin-key[data-value="${d}"]`);
        await page1.waitForTimeout(60);
    }
    await page1.waitForTimeout(1000);

    // 4. 최상단 헤더 영역
    const headerEl = await page1.$('header.app-header');
    if (headerEl) {
        await headerEl.screenshot({ path: path.join(outDir, '03_header_theme.png') });
        console.log('Saved 03_header_theme.png');
    }

    // 5. 비용 정산 탭 전체 화면
    await page1.screenshot({ path: path.join(outDir, '04_settlement_tab.png'), clip: { x: 40, y: 145, width: 1360, height: 750 } });
    console.log('Saved 04_settlement_tab.png');

    // 5-1. 비용 항목 추가 카드 전체
    const expenseCard = await page1.$('#expense-form').then(el => el ? el.evaluateHandle(e => e.closest('.card')) : null);
    if (expenseCard) {
        await expenseCard.screenshot({ path: path.join(outDir, '05_expense_form.png') });
        console.log('Saved 05_expense_form.png');
    }

    // 5-2. 자동 정산 결과 카드
    const resultCard = await page1.$('#result-card');
    if (resultCard) {
        await resultCard.scrollIntoViewIfNeeded();
        await page1.waitForTimeout(300);
        await resultCard.screenshot({ path: path.join(outDir, '06_settlement_result.png') });
        console.log('Saved 06_settlement_result.png');
    }

    // 6. 전사원 명부 탭
    const dirTabBtn = await page1.$('#directory-tab-btn');
    if (dirTabBtn) {
        await dirTabBtn.click();
        await page1.waitForTimeout(800);
        await page1.screenshot({ path: path.join(outDir, '07_directory_tab.png'), clip: { x: 40, y: 145, width: 1360, height: 750 } });
        console.log('Saved 07_directory_tab.png');
    }

    // 7. 정산 이력 탭
    const historyTabBtn = await page1.$('#history-tab-btn');
    if (historyTabBtn) {
        await historyTabBtn.click();
        await page1.waitForTimeout(800);
        await page1.screenshot({ path: path.join(outDir, '08_history_tab.png'), clip: { x: 40, y: 145, width: 1360, height: 750 } });
        console.log('Saved 08_history_tab.png');
    }
    await memberContext.close();

    // ==========================================
    // 세션 2: 관리자 (000000)
    // ==========================================
    console.log('--- Starting Session 2: Admin ---');
    const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page2 = await adminContext.newPage();
    await page2.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle' });
    await page2.evaluate(() => {
        try {
            localStorage.setItem('club_expense_admin_theme', 'light');
            document.documentElement.dataset.appTheme = 'light';
            document.querySelectorAll('.admin-themed-pane').forEach(p => p.dataset.adminTheme = 'light');
        } catch (_) {}
    });
    await page2.waitForTimeout(300);

    for (let i = 0; i < 6; i++) {
        await page2.click('button.pin-key[data-value="0"]');
        await page2.waitForTimeout(60);
    }
    await page2.waitForTimeout(1000);
    await page2.evaluate(() => {
        try {
            if (typeof applyAdminTheme === 'function') applyAdminTheme('light');
            document.documentElement.dataset.appTheme = 'light';
            document.querySelectorAll('.admin-themed-pane').forEach(p => p.dataset.adminTheme = 'light');
        } catch (_) {}
    });
    await page2.waitForTimeout(400);

    // 8. [관리자] 대시보드 관리 탭
    const adminTabBtn = await page2.$('#admin-tab-btn');
    if (adminTabBtn) {
        await adminTabBtn.click();
        await page2.waitForTimeout(1200);
        await page2.screenshot({ path: path.join(outDir, '09_admin_dashboard.png'), clip: { x: 40, y: 145, width: 1360, height: 750 } });
        console.log('Saved 09_admin_dashboard.png');

        // 연간 결산 PPT 모달 열기
        const pptBtn = await page2.$('#admin-export-ppt-btn');
        if (pptBtn) {
            await pptBtn.click();
            await page2.waitForTimeout(800);
            const pptCard = await page2.$('#year-end-ppt-modal .modal-content-card');
            if (pptCard) {
                await pptCard.screenshot({ path: path.join(outDir, '12_ppt_modal.png') });
                console.log('Saved 12_ppt_modal.png');
            }
            const closePptBtn = await page2.$('#close-year-end-ppt-modal');
            if (closePptBtn) await closePptBtn.click();
            await page2.waitForTimeout(400);
        }
    }

    // 9. [관리자] 클럽별 정산이력 탭
    const clubHistBtn = await page2.$('#club-history-tab-btn');
    if (clubHistBtn) {
        await clubHistBtn.click();
        await page2.waitForTimeout(800);
        await page2.screenshot({ path: path.join(outDir, '10_club_history_tab.png'), clip: { x: 40, y: 145, width: 1360, height: 750 } });
        console.log('Saved 10_club_history_tab.png');
    }

    // 10. [관리자] 차트 탭
    const chartsTabBtn = await page2.$('#charts-tab-btn');
    if (chartsTabBtn) {
        await chartsTabBtn.click();
        await page2.waitForTimeout(1000);
        const selectAllCheckbox = await page2.$('input[data-overall-select-all]');
        if (selectAllCheckbox) {
            const isChecked = await selectAllCheckbox.isChecked();
            if (!isChecked) {
                await selectAllCheckbox.click();
                await page2.waitForTimeout(1500);
            }
        }
        await page2.screenshot({ path: path.join(outDir, '11_charts_tab.png'), clip: { x: 40, y: 145, width: 1360, height: 750 } });
        console.log('Saved 11_charts_tab.png');

        // 차트 상세 그래프 영역 스크롤 및 캡처
        const chartsGrid = await page2.$('.charts-premium-grid');
        if (chartsGrid) {
            await chartsGrid.scrollIntoViewIfNeeded();
            await page2.waitForTimeout(800);
            await page2.screenshot({ path: path.join(outDir, '11_charts_graphs.png'), clip: { x: 40, y: 100, width: 1360, height: 780 } });
            console.log('Saved 11_charts_graphs.png');
        }
    }

    await adminContext.close();
    await browser.close();
    console.log('ALL SCREENSHOTS CAPTURED SUCCESSFULLY!');
})();
