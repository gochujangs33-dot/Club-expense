const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
    console.log('=== Starting Mobile User Screen Capture ===');
    const outDir = path.join(__dirname, 'ppt_screenshots_mobile');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const browser = await chromium.launch();
    // 모바일 뷰포트 (아이폰/갤럭시 표준 390x844)
    const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2
    });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle' });

    // 라이트 테마 설정
    await page.evaluate(() => {
        try {
            localStorage.setItem('club_expense_admin_theme', 'light');
            document.documentElement.dataset.appTheme = 'light';
            document.querySelectorAll('.admin-themed-pane').forEach(p => p.dataset.adminTheme = 'light');
        } catch (_) {}
    });
    await page.waitForTimeout(500);

    // 1. 모바일 로그인 화면
    await page.screenshot({ path: path.join(outDir, 'm01_login.png') });
    console.log('Saved m01_login.png');

    // 2. 모바일 회원 등록 화면
    const goRegisterBtn = await page.$('#go-to-register');
    if (goRegisterBtn) {
        await goRegisterBtn.click();
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(outDir, 'm02_register.png') });
        console.log('Saved m02_register.png');
        const backLoginBtn = await page.$('#go-to-login');
        if (backLoginBtn) await backLoginBtn.click();
        await page.waitForTimeout(300);
    }

    // 3. 일반 사용자 로그인 (002531)
    const pinDigits = ['0', '0', '2', '5', '3', '1'];
    for (const d of pinDigits) {
        await page.click(`button.pin-key:has-text("${d}")`);
        await page.waitForTimeout(80);
    }
    await page.waitForTimeout(1000);

    // 4. 모바일 메인 헤더 & 정산 탭 기본 화면
    await page.screenshot({ path: path.join(outDir, 'm03_settle_main.png') });
    console.log('Saved m03_settle_main.png');

    // 5. 모바일 전사원 명부 탭
    const dirTabBtn = await page.$('#directory-tab-btn');
    if (dirTabBtn) {
        await dirTabBtn.click();
        await page.waitForTimeout(700);
        await page.screenshot({ path: path.join(outDir, 'm04_directory_tab.png') });
        console.log('Saved m04_directory_tab.png');

        // 검색어 입력
        const searchInput = await page.$('#directory-search-input');
        if (searchInput) {
            await searchInput.fill('김');
            await page.waitForTimeout(400);
            await page.screenshot({ path: path.join(outDir, 'm05_directory_search.png') });
            console.log('Saved m05_directory_search.png');
            await searchInput.fill('');
            await page.waitForTimeout(300);
        }
    }

    // 6. 다시 정산 탭으로 이동
    const settleTabBtn = await page.$('#settlement-tab-btn');
    if (settleTabBtn) {
        await settleTabBtn.click();
        await page.waitForTimeout(500);
    }

    // 7. 비용 항목 입력 폼으로 스크롤
    await page.evaluate(() => {
        const el = document.getElementById('expense-desc');
        if (el) el.scrollIntoView({ behavior: 'instant', block: 'center' });
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, 'm06_expense_form.png') });
    console.log('Saved m06_expense_form.png');

    // 8. [❓ 정산 기준] 팝업 열기
    const rulesBtn = await page.$('#expense-rules-guide-btn');
    if (rulesBtn) {
        await rulesBtn.click();
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(outDir, 'm07_rules_modal.png') });
        console.log('Saved m07_rules_modal.png');
        const closeRulesBtn = await page.$('#rules-guide-modal-close-btn');
        if (closeRulesBtn) await closeRulesBtn.click();
        await page.waitForTimeout(300);
    }

    // 9. 비용 항목 입력 및 결과 확인
    const descInput = await page.$('#expense-desc');
    const amtInput = await page.$('#expense-amount');
    const addBtn = await page.$('#add-expense-btn');
    if (descInput && amtInput && addBtn) {
        await descInput.fill('모바일 정산 식사');
        await amtInput.fill('90000');
        await page.waitForTimeout(200);
        await addBtn.click();
        await page.waitForTimeout(600);
    }

    // 결과 카드로 스크롤
    await page.evaluate(() => {
        const el = document.getElementById('final-self-pay-display') || document.getElementById('result-final-support');
        if (el) el.scrollIntoView({ behavior: 'instant', block: 'center' });
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, 'm08_settle_result.png') });
    console.log('Saved m08_settle_result.png');

    // 10. 모바일 정산 이력 탭
    const historyTabBtn = await page.$('#history-tab-btn');
    if (historyTabBtn) {
        await historyTabBtn.click();
        await page.waitForTimeout(700);
        await page.screenshot({ path: path.join(outDir, 'm09_history_tab.png') });
        console.log('Saved m09_history_tab.png');
    }

    await browser.close();
    console.log('=== All Mobile User Screens Captured Successfully! ===');
})();
