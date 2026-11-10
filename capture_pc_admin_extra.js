const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
    console.log('=== Capturing PC Admin Extra Screens ===');
    const outDir = path.join(__dirname, 'ppt_screenshots');

    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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

    // 관리자(000000) 로그인
    const pinDigits = ['0', '0', '0', '0', '0', '0'];
    for (const d of pinDigits) {
        await page.click(`button.pin-key:has-text("${d}")`);
        await page.waitForTimeout(50);
    }
    await page.waitForTimeout(1000);

    // 1. 관리자 대시보드 탭으로 이동
    const adminTabBtn = await page.$('#admin-tab-btn');
    if (adminTabBtn) {
        await adminTabBtn.click();
        await page.waitForTimeout(700);
        await page.screenshot({ path: path.join(outDir, '09_admin_dashboard_wide.png') });
        console.log('Saved 09_admin_dashboard_wide.png');

        // 전체 작업 로그 모달 열기
        const logBtn = await page.$('#admin-audit-log-btn');
        if (logBtn) {
            await logBtn.click();
            await page.waitForTimeout(600);
            await page.screenshot({ path: path.join(outDir, '13_audit_log_modal.png') });
            console.log('Saved 13_audit_log_modal.png');
            const closeLogBtn = await page.$('#close-audit-log-modal');
            if (closeLogBtn) await closeLogBtn.click();
            await page.waitForTimeout(300);
        }
    }

    await browser.close();
    console.log('=== PC Admin Extra Screens Captured! ===');
})();
