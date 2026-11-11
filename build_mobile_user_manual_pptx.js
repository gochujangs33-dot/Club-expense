const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
    console.log('--- Building Mobile User Manual PPTX ---');
    const outDir = path.join(__dirname, 'ppt_screenshots_mobile');

    const getImgBase64 = (filename) => {
        const p = path.join(outDir, filename);
        if (fs.existsSync(p)) return fs.readFileSync(p).toString('base64');
        console.warn(`File not found: ${filename}`);
        return null;
    };

    const images = {
        login: getImgBase64('m01_login.png'),
        register: getImgBase64('m02_register.png'),
        settleMain: getImgBase64('m03_settle_main.png'),
        dirTab: getImgBase64('m04_directory_tab.png'),
        expenseForm: getImgBase64('m06_expense_form.png'),
        rulesModal: getImgBase64('m07_rules_modal.png'),
        settleResult: getImgBase64('m08_settle_result.png'),
        historyTab: getImgBase64('m09_history_tab.png')
    };

    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle' });

    const pptxBase64 = await page.evaluate(async (imgs) => {
        const pptx = new window.PptxGenJS();
        pptx.layout = 'LAYOUT_16x9';

        const C = {
            bg: 'F8FAFC',
            cardBg: 'FFFFFF',
            cardBorder: 'E2E8F0',
            primary: '2563EB',
            primaryLight: 'EFF6FF',
            primaryDark: '1D4ED8',
            emerald: '059669',
            emeraldLight: 'ECFDF5',
            amber: 'D97706',
            amberLight: 'FFFBEB',
            rose: 'E11D48',
            roseLight: 'FFF1F2',
            purple: '7C3AED',
            purpleLight: 'F5F3FF',
            textMain: '0F172A',
            textSub: '475569',
            textMuted: '64748B',
            white: 'FFFFFF'
        };

        const FONT_TITLE = 'Malgun Gothic';
        const FONT_BODY = 'Malgun Gothic';

        function createMobileSlide(title, subtitle, stepBadge = '모바일 사용자 매뉴얼') {
            const slide = pptx.addSlide();
            slide.addShape(pptx.shapes.RECTANGLE, {
                x: 0, y: 0, w: 10, h: 5.625,
                fill: { color: C.bg }, line: { color: C.bg }
            });
            slide.addShape(pptx.shapes.RECTANGLE, {
                x: 0, y: 0, w: 10, h: 0.08,
                fill: { color: C.primary }, line: { color: C.primary }
            });

            // 상단 배지
            slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 0.6, y: 0.28, w: 2.5, h: 0.32,
                fill: { color: C.primaryLight }, line: { color: 'BFDBFE', width: 1 },
                rectRadius: 0.08
            });
            slide.addText(`📱 ${stepBadge}`, {
                x: 0.6, y: 0.28, w: 2.5, h: 0.32,
                fontSize: 9, fontFace: FONT_TITLE, color: C.primaryDark, bold: true, align: 'center', valign: 'middle',
                margin: 0
            });

            slide.addText(title, {
                x: 3.3, y: 0.24, w: 6.1, h: 0.38,
                fontSize: 15.5, fontFace: FONT_TITLE, color: C.textMain, bold: true,
                margin: 0
            });

            slide.addText(subtitle, {
                x: 0.6, y: 0.68, w: 8.8, h: 0.28,
                fontSize: 9.8, fontFace: FONT_BODY, color: C.textSub,
                margin: 0
            });

            slide.addShape(pptx.shapes.LINE, {
                x: 0.6, y: 1.02, w: 8.8, h: 0,
                line: { color: C.cardBorder, width: 1 }
            });

            return slide;
        }

        // ==========================================
        // SLIDE 1: 표지 (Cover - Light Theme)
        // ==========================================
        {
            const s1 = pptx.addSlide();
            s1.addShape(pptx.shapes.RECTANGLE, {
                x: 0, y: 0, w: 10, h: 5.625,
                fill: { color: C.bg }, line: { color: C.bg }
            });
            // 상단 장식 바
            s1.addShape(pptx.shapes.RECTANGLE, {
                x: 0, y: 0, w: 10, h: 0.12,
                fill: { color: C.primary }, line: { color: C.primary }
            });

            // 메인 뱃지
            s1.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 0.8, y: 0.85, w: 3.3, h: 0.40,
                fill: { color: C.primaryLight }, line: { color: 'BFDBFE', width: 1.2 },
                rectRadius: 0.08
            });
            s1.addText('📱 3M 사내 클럽 비용 정산기 (v1.7.0)', {
                x: 0.8, y: 0.85, w: 3.3, h: 0.40,
                fontSize: 10.5, fontFace: FONT_TITLE, color: C.primaryDark, bold: true, align: 'center', valign: 'middle'
            });

            // 타이틀
            s1.addText('모바일 사용자 실무 매뉴얼', {
                x: 0.8, y: 1.45, w: 8.4, h: 0.85,
                fontSize: 32, fontFace: FONT_TITLE, color: C.textMain, bold: true
            });

            // 부제목
            s1.addText('스마트폰 화면 하나로 3초 로그인부터 실시간 영수증 정산, 공식 엑셀 출력까지!', {
                x: 0.8, y: 2.38, w: 8.4, h: 0.38,
                fontSize: 12.5, fontFace: FONT_BODY, color: C.textSub
            });

            // 3대 핵심 특징 카드 (라이트 카드)
            const features = [
                { icon: '⚡', title: '설치 없는 모바일 웹앱', desc: '스마트폰 브라우저로 즉시 접속, 홈 화면 추가로 앱처럼 사용', color: C.primary },
                { icon: '👥', title: '1,316명 명부 & 👑 왕관', desc: '동명이인 사번 자동 구분 및 연간 최다 참석자 왕관 배지', color: C.purple },
                { icon: '📊', title: '4구간 자동 계산 & 엑셀', desc: '개인/법인카드 분할 및 회사 공식 품의 엑셀 원클릭 다운로드', color: C.emerald }
            ];

            features.forEach((f, idx) => {
                const fx = 0.8 + idx * 2.85;
                s1.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                    x: fx, y: 3.05, w: 2.65, h: 1.45,
                    fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                    rectRadius: 0.1
                });
                s1.addText(f.icon, {
                    x: fx + 0.2, y: 3.18, w: 0.5, h: 0.38,
                    fontSize: 18, align: 'left'
                });
                s1.addText(f.title, {
                    x: fx + 0.2, y: 3.58, w: 2.25, h: 0.28,
                    fontSize: 11, fontFace: FONT_TITLE, color: f.color, bold: true
                });
                s1.addText(f.desc, {
                    x: fx + 0.2, y: 3.90, w: 2.25, h: 0.48,
                    fontSize: 8.8, fontFace: FONT_BODY, color: C.textSub, lineSpacing: 13
                });
            });

            // 하단 메타정보
            s1.addText('배포일: 2026. 11. 11  |  모바일 실무 사용자 전용  |  시스템 버전: v1.7.0 (최신 정식 배포판)', {
                x: 0.8, y: 4.88, w: 8.4, h: 0.35,
                fontSize: 9.2, fontFace: FONT_BODY, color: C.textMuted
            });
        }

        // ==========================================
        // SLIDE 2: 모바일 접속 및 홈 화면 추가
        // ==========================================
        {
            const s2 = createMobileSlide(
                '모바일 접속 & 홈 화면 바로가기 추가 (PWA)',
                '별도의 앱스토어 설치 없이 스마트폰 브라우저에서 바로 접속하고, 홈 화면에 추가하여 앱처럼 실행합니다.'
            );

            // 좌측: 모바일 로그인 화면 캡처
            if (imgs.login) {
                s2.addImage({
                    data: 'image/png;base64,' + imgs.login,
                    x: 0.8, y: 1.25, w: 2.3, h: 4.0
                });
            }

            // 우측: 접속 및 홈 화면 추가 가이드 카드
            s2.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 3.4, y: 1.25, w: 6.0, h: 4.0,
                fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                rectRadius: 0.12
            });

            s2.addText('📲 스마트폰 홈 화면에 추가하는 방법', {
                x: 3.7, y: 1.45, w: 5.4, h: 0.35,
                fontSize: 13, fontFace: FONT_TITLE, color: C.primary, bold: true
            });

            const pwaSteps = [
                {
                    os: '아이폰 (Safari)',
                    steps: '사파리로 정산기 웹페이지 접속 ➔ 하단 공유 버튼(네모+화살표) 클릭 ➔ [홈 화면에 추가] 선택 ➔ 스마트폰 바탕화면에 전용 앱 아이콘 생성 완료!'
                },
                {
                    os: '안드로이드 / 갤럭시 (Chrome / 삼성인터넷)',
                    steps: '크롬 또는 삼성 인터넷 접속 ➔ 우측 상단 메뉴(점 3개) 클릭 ➔ [앱 설치] 또는 [현재 페이지 추가 ➔ 홈 화면] 선택 ➔ 바탕화면에 1초 바로가기 생성 완료!'
                },
                {
                    os: '오프라인 캐시 및 자동 업데이트',
                    steps: 'Service Worker 기술이 탑재되어 네트워크가 불안정해도 안정적으로 실행되며, 최신 버전 배포 시 실행 즉시 자동 업데이트 배너가 안내됩니다.'
                }
            ];

            pwaSteps.forEach((p, idx) => {
                const py = 1.95 + idx * 0.95;
                s2.addText([
                    { text: `• ${p.os}\n`, options: { bold: true, fontSize: 10.5, color: C.textMain } },
                    { text: p.steps, options: { fontSize: 8.8, color: C.textSub } }
                ], {
                    x: 3.7, y: py, w: 5.4, h: 0.85,
                    lineSpacing: 13, valign: 'top'
                });
            });

            s2.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 3.7, y: 4.5, w: 5.4, h: 0.55,
                fill: { color: C.emeraldLight }, line: { color: '#A7F3D0', width: 1 },
                rectRadius: 0.08
            });
            s2.addText('💡 이제 회식이나 행사 현장에서 계산 직후 스마트폰을 꺼내 30초 만에 정산을 끝내실 수 있습니다.', {
                x: 3.9, y: 4.52, w: 5.0, h: 0.5,
                fontSize: 8.8, fontFace: FONT_BODY, color: '#065F46', bold: true, valign: 'middle'
            });
        }

        // ==========================================
        // SLIDE 3: Step 1. 모바일 1초 PIN 로그인 & 회원 등록
        // ==========================================
        {
            const s3 = createMobileSlide(
                'Step 1. 모바일 1초 PIN 간편 로그인 & 회원 등록',
                '아이디·비밀번호 없이 사번 끝 6자리 PIN 번호로 모바일 키패드를 탭하여 1초 만에 안전하게 로그인합니다.'
            );

            // 좌측: 로그인 화면 캡처
            if (imgs.login) {
                s3.addImage({
                    data: 'image/png;base64,' + imgs.login,
                    x: 0.8, y: 1.25, w: 2.1, h: 4.0
                });
            }

            // 가운데: 회원 등록 화면 캡처
            if (imgs.register) {
                s3.addImage({
                    data: 'image/png;base64,' + imgs.register,
                    x: 3.1, y: 1.25, w: 2.1, h: 4.0
                });
            }

            // 우측: 로그인 가이드 카드
            s3.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 5.4, y: 1.25, w: 4.0, h: 4.0,
                fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                rectRadius: 0.12
            });

            s3.addText('🔑 간편 로그인 & 회원 가입 안내', {
                x: 5.65, y: 1.45, w: 3.5, h: 0.35,
                fontSize: 12.5, fontFace: FONT_TITLE, color: C.primary, bold: true
            });

            const loginGuides = [
                { title: '① 사번 기반 6자리 PIN 로그인', text: '복잡한 영문/특수문자 없이 본인 사번 끝자리(또는 등록한 6자리 숫자)를 터치 키패드로 입력' },
                { title: '② 신규 회원 3초 등록 (최초 1회)', text: '하단 [신규 등록] 클릭 후 이름과 PIN 6자리만 입력하면 즉시 계정이 생성되고 자동 로그인' },
                { title: '③ 모바일 터치 최적화 키패드', text: '숫자 버튼이 큼직하게 배치되어 스마트폰 한 손 조작으로 오타 없이 신속하게 입력' },
                { title: '④ 로그인 상태 자동 유지', text: '한 번 로그인하면 브라우저에 안전하게 세션이 유지되어 매번 재입력하는 번거로움 해소' }
            ];

            loginGuides.forEach((g, idx) => {
                const gy = 1.9 + idx * 0.72;
                s3.addText([
                    { text: `${g.title}\n`, options: { bold: true, fontSize: 9.8, color: C.textMain } },
                    { text: g.text, options: { fontSize: 8.2, color: C.textSub } }
                ], {
                    x: 5.65, y: gy, w: 3.5, h: 0.65,
                    lineSpacing: 12, valign: 'top'
                });
            });
        }

        // ==========================================
        // SLIDE 4: Step 2. 모바일 전사원 명부 & 최다 참석 왕관(👑)
        // ==========================================
        {
            const s4 = createMobileSlide(
                'Step 2. 모바일 전사원 명부 검색 & 👑 최다 참석자 왕관',
                '전사 1,316명 임직원 DB가 실시간 연동되며, 초성 검색과 올해 최다 참석 1위 왕관(👑) 배지를 지원합니다.'
            );

            if (imgs.dirTab) {
                s4.addImage({
                    data: 'image/png;base64,' + imgs.dirTab,
                    x: 0.8, y: 1.25, w: 2.3, h: 4.0
                });
            }

            s4.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 3.4, y: 1.25, w: 6.0, h: 4.0,
                fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                rectRadius: 0.12
            });

            s4.addText('👥 모바일 명부 & 참석자 관리 핵심', {
                x: 3.7, y: 1.45, w: 5.4, h: 0.35,
                fontSize: 13, fontFace: FONT_TITLE, color: C.purple, bold: true
            });

            const dirGuides = [
                {
                    title: '① 👑 최다 참석 1위 황금 왕관 배지 (NEW)',
                    desc: '올 한 해 동안 동아리 행사에 가장 많이 참석한 1등(공동 1등 포함) 임직원 이름 앞에 빛나는 황금 왕관(👑)과 골드 배지가 자동 부여됩니다.'
                },
                {
                    title: '② 한 글자·초성 초고속 실시간 검색',
                    desc: '상단 검색창에 이름의 첫 글자(예: "김") 또는 초성(예: "ㄱ")만 쳐도 1,316명 중 일치하는 사원이 실시간 필터링되어 즉시 나타납니다.'
                },
                {
                    title: '③ 고유 사번(EMP ID) 기반 동명이인 완벽 구분',
                    desc: '이름이 같아도 고유 사번으로 구분 관리되므로 참석 횟수가 엉뚱한 동명이인에게 잘못 합산되는 오류를 원천 차단합니다.'
                },
                {
                    title: '④ 모바일 신규 사원 즉시 등록',
                    desc: '신입 사원이나 전입자가 명부에 없더라도 [사원 등록] 카드에서 이름과 사번만 입력하면 전사원 명부에 실시간 즉시 반영됩니다.'
                }
            ];

            dirGuides.forEach((d, idx) => {
                const dy = 1.9 + idx * 0.74;
                s4.addText([
                    { text: `${d.title}\n`, options: { bold: true, fontSize: 10, color: C.textMain } },
                    { text: d.desc, options: { fontSize: 8.5, color: C.textSub } }
                ], {
                    x: 3.7, y: dy, w: 5.4, h: 0.68,
                    lineSpacing: 12.5, valign: 'top'
                });
            });
        }

        // ==========================================
        // SLIDE 5: Step 3. 모바일 비용 항목 입력 & 결제 수단 분할
        // ==========================================
        {
            const s5 = createMobileSlide(
                'Step 3. 모바일 비용 항목 입력 & 자부담 직접 조정',
                '행사비·시설비·상품비를 구분하고, [법인/개인 카드] 분할 및 1인당 자부담을 스마트폰에서 손쉽게 입력합니다.'
            );

            if (imgs.expenseForm) {
                s5.addImage({
                    data: 'image/png;base64,' + imgs.expenseForm,
                    x: 0.8, y: 1.25, w: 2.3, h: 4.0
                });
            }

            s5.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 3.4, y: 1.25, w: 6.0, h: 4.0,
                fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                rectRadius: 0.12
            });

            s5.addText('💳 모바일 비용 입력 & 분할 결제 꿀팁', {
                x: 3.7, y: 1.45, w: 5.4, h: 0.35,
                fontSize: 13, fontFace: FONT_TITLE, color: C.amber, bold: true
            });

            const expenseGuides = [
                {
                    title: '① 3대 비용 구분 (행사비 / 시설비 / 상품비)',
                    desc: '• 행사비: 식대·다과 등 순수 행사 비용 (4구간 자부담 지원 공식 적용)\n• 시설 및 장비: 인당 85,000원 한도 내 우선 지원 (초과분 자부담)\n• 상품비: 클럽당 연간 50만원 한도 내 실시간 감시'
                },
                {
                    title: '② [법인카드 / 개인카드] 실시간 자동 분할',
                    desc: '금액을 입력하면 회사 규정과 잔여 예산에 맞춰 법인카드 지원금과 개인카드 결제액이 1원 단위까지 100% 자동 분할 제안됩니다.'
                },
                {
                    title: '③ 1인당 자부담 직접 입력 & 사규 최소 기준 검증 (NEW)',
                    desc: '영수증 상황에 맞춰 [개인카드] 또는 [1인당 자부담]을 직접 원하는 금액으로 입력할 수 있으며, 사규 최소 기준 미달 시 자동으로 안내 및 방지됩니다.'
                }
            ];

            expenseGuides.forEach((e, idx) => {
                const ey = 1.9 + idx * 0.95;
                s5.addText([
                    { text: `${e.title}\n`, options: { bold: true, fontSize: 10, color: C.textMain } },
                    { text: e.desc, options: { fontSize: 8.3, color: C.textSub } }
                ], {
                    x: 3.7, y: ey, w: 5.4, h: 0.88,
                    lineSpacing: 12.5, valign: 'top'
                });
            });
        }

        // ==========================================
        // SLIDE 6: Step 4. 모바일 [❓ 정산 기준] 4구간 안내 모달
        // ==========================================
        {
            const s6 = createMobileSlide(
                'Step 4. 모바일 [❓ 정산 기준] 4구간 지원표 & 안내 모달',
                '금액 입력란 옆 물음표 클릭 시 4구간 누진 공식과 경계값 예시가 모바일 화면에 즉시 팝업 안내됩니다.'
            );

            if (imgs.rulesModal) {
                s6.addImage({
                    data: 'image/png;base64,' + imgs.rulesModal,
                    x: 0.8, y: 1.25, w: 2.3, h: 4.0
                });
            }

            s6.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 3.4, y: 1.25, w: 6.0, h: 4.0,
                fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                rectRadius: 0.12
            });

            s6.addText('📋 3M 사내 동아리 4구간 지원 기준 (인당 행사비 기준)', {
                x: 3.7, y: 1.45, w: 5.4, h: 0.35,
                fontSize: 12.5, fontFace: FONT_TITLE, color: C.primary, bold: true
            });

            const ruleTiers = [
                {
                    name: '가. 전액 지원 (1인당 30,000원 이하)',
                    badge: '자부담 0% · 회사 100% 지원',
                    desc: '인당 3만원 이하 지출 시 개인 부담금 전혀 없이 회사가 전액 지원합니다.'
                },
                {
                    name: '나. 일반 지원 (30,001원 ~ 60,000원)',
                    badge: '자부담 20% · 회사 80% 지원',
                    desc: '3만원 초과 시 전체 금액의 20%를 개인이 부담하고 80%를 회사가 지원합니다.'
                },
                {
                    name: '다. 초과 누진 (60,001원 ~ 120,000원)',
                    badge: '초과분만 40% 누진 부담',
                    desc: '앞 6만원은 20%(12,000원)만 내고, 6만원 초과분에 대해서만 40%를 내도록 완화 적용됩니다.'
                },
                {
                    name: '라. 한도 초과 (120,001원 초과)',
                    badge: '인당 최대 85,000원 지원 캡',
                    desc: '인당 최대 85,000원까지만 법인카드로 지원되며, 85,000원 초과분은 전액 개인이 부담합니다.'
                }
            ];

            ruleTiers.forEach((r, idx) => {
                const ry = 1.88 + idx * 0.74;
                s6.addText([
                    { text: `${r.name}  [${r.badge}]\n`, options: { bold: true, fontSize: 9.5, color: C.textMain } },
                    { text: r.desc, options: { fontSize: 8.2, color: C.textSub } }
                ], {
                    x: 3.7, y: ry, w: 5.4, h: 0.68,
                    lineSpacing: 12, valign: 'top'
                });
            });
        }

        // ==========================================
        // SLIDE 7: Step 5. 모바일 자동 정산 결과 확인 & 원클릭 완료
        // ==========================================
        {
            const s7 = createMobileSlide(
                'Step 5. 모바일 자동 정산 결과 & 원클릭 [정산 완료]',
                '참석자 1인당 자부담 비용과 클럽 잔여 예산이 실시간 산출되며, 클릭 한 번으로 정산이 마감됩니다.'
            );

            if (imgs.settleResult) {
                s7.addImage({
                    data: 'image/png;base64,' + imgs.settleResult,
                    x: 0.8, y: 1.25, w: 2.3, h: 4.0
                });
            }

            s7.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 3.4, y: 1.25, w: 6.0, h: 4.0,
                fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                rectRadius: 0.12
            });

            s7.addText('⚡ 모바일 결과 화면 보는 법', {
                x: 3.7, y: 1.45, w: 5.4, h: 0.35,
                fontSize: 13, fontFace: FONT_TITLE, color: C.emerald, bold: true
            });

            const resultItems = [
                {
                    title: '🔥 인당 자부담 비용 (가장 중요한 금액!)',
                    desc: '참석자 1명이 개인 계좌로 입금하거나 현장 결제할 1인당 분담금입니다. (자부담이 100원 이상이면 🔥 불꽃, 0원이면 😊 미소 아이콘 표시)'
                },
                {
                    title: '💳 최종 지원금 (법인카드 승인액)',
                    desc: '회사 규정과 클럽 잔여 예산 범위 내에서 결제할 법인카드 총 승인 금액입니다.'
                },
                {
                    title: '💰 총 자부담 금액 (자동 일원화)',
                    desc: '비용 항목별 개인카드 합산 금액이 텍스트로 자동 일원화 표시되어 수기 계산 실수를 방지합니다.'
                },
                {
                    title: '📊 클럽 잔여 예산 실시간 차감 게이지',
                    desc: '이번 정산 집행 후 남은 클럽 잔여 예산과 누적 소진율(%)이 하단 프로그레스 바로 즉시 확인됩니다.'
                },
                {
                    title: '💾 [정산 완료] 버튼 터치',
                    desc: '정산 내역이 Firebase 클라우드 DB에 즉시 영구 저장되며, 참석자 카운트가 자동 누적됩니다.'
                }
            ];

            resultItems.forEach((r, idx) => {
                const ry = 1.88 + idx * 0.58;
                s7.addText([
                    { text: `${r.title}\n`, options: { bold: true, fontSize: 9.3, color: C.textMain } },
                    { text: r.desc, options: { fontSize: 8.0, color: C.textSub } }
                ], {
                    x: 3.7, y: ry, w: 5.4, h: 0.54,
                    lineSpacing: 11.5, valign: 'top'
                });
            });
        }

        // ==========================================
        // SLIDE 8: Step 6. 모바일 정산 이력 & 공식 엑셀 다운로드
        // ==========================================
        {
            const s8 = createMobileSlide(
                'Step 6. 모바일 정산 이력 & 공식 엑셀 품의서 다운로드',
                '과거 정산 이력을 모바일 카드 형태로 언제든 조회하고, 회사 공식 품의 엑셀을 즉시 다운로드합니다.'
            );

            if (imgs.historyTab) {
                s8.addImage({
                    data: 'image/png;base64,' + imgs.historyTab,
                    x: 0.8, y: 1.25, w: 2.3, h: 4.0
                });
            }

            s8.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 3.4, y: 1.25, w: 6.0, h: 4.0,
                fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                rectRadius: 0.12
            });

            s8.addText('📑 모바일 정산 이력 & 엑셀 활용 가이드', {
                x: 3.7, y: 1.45, w: 5.4, h: 0.35,
                fontSize: 13, fontFace: FONT_TITLE, color: C.emerald, bold: true
            });

            const historyGuides = [
                {
                    title: '① 모바일 최적화 이력 카드',
                    desc: '행사 날짜, 정산인, 참석 인원, 총 지출액, 회사 지원금, 자부담이 스마트폰 화면에 맞게 깔끔한 모바일 카드로 정렬됩니다.'
                },
                {
                    title: '② 원클릭 [초록색 엑셀] 다운로드',
                    desc: '스마트폰 브라우저에서 [엑셀] 버튼을 누르면 회사 공식 결재 서식에 모든 셀(K4~K30 등)이 100% 자동 채워진 .xlsx 파일이 즉시 다운로드됩니다.'
                },
                {
                    title: '③ 모바일 영수증 & 행사 사진 확인',
                    desc: '정산 등록 시 첨부했던 영수증과 단체 행사 사진을 스마트폰 화면에서 터치하여 원본 크기로 선명하게 확대 확인 가능합니다.'
                },
                {
                    title: '④ 이메일 정산서 초안 모바일 복사',
                    desc: '동아리 회원들에게 정산 내역을 공지할 때 [이메일 초안]을 누르면 완성된 안내 텍스트가 클립보드에 원터치 복사됩니다.'
                }
            ];

            historyGuides.forEach((h, idx) => {
                const hy = 1.9 + idx * 0.74;
                s8.addText([
                    { text: `${h.title}\n`, options: { bold: true, fontSize: 10, color: C.textMain } },
                    { text: h.desc, options: { fontSize: 8.5, color: C.textSub } }
                ], {
                    x: 3.7, y: hy, w: 5.4, h: 0.68,
                    lineSpacing: 12.5, valign: 'top'
                });
            });
        }

        // ==========================================
        // SLIDE 9: 사용자 FAQ
        // ==========================================
        {
            const s9 = pptx.addSlide();
            s9.addShape(pptx.shapes.RECTANGLE, {
                x: 0, y: 0, w: 10, h: 5.625,
                fill: { color: C.bg }, line: { color: C.bg }
            });
            s9.addShape(pptx.shapes.RECTANGLE, {
                x: 0, y: 0, w: 10, h: 0.1,
                fill: { color: C.primary }, line: { color: C.primary }
            });

            s9.addText('모바일 실무 사용자 자주 묻는 질문 (FAQ)', {
                x: 0.8, y: 0.45, w: 8.4, h: 0.4,
                fontSize: 18, fontFace: FONT_TITLE, color: C.textMain, bold: true
            });
            s9.addText('모바일 정산 중 자주 겪는 상황에 대한 해결 방법입니다.', {
                x: 0.8, y: 0.88, w: 8.4, h: 0.28,
                fontSize: 10.5, fontFace: FONT_BODY, color: C.textSub
            });

            const userFaqs = [
                {
                    q: 'Q1. 실제 영수증 상황에 맞춰 자부담 금액을 조정할 수 있나요?',
                    a: 'A: 네! [비용 항목 추가/수정] 폼에서 [개인카드] 금액이나 [1인당 자부담]을 원하는 금액으로 직접 입력하시면 실시간 반영됩니다. 단, 회사 규정상 최소 자부담 기준보다 적게 입력하는 것은 자동으로 감지되어 방지됩니다.'
                },
                {
                    q: 'Q2. 스마트폰에서 작성하다가 화면을 닫으면 입력한 내용이 날아가나요?',
                    a: 'A: 날아가지 않습니다! 브라우저 로컬 세션에 임시 저장되므로 실수로 창을 닫거나 새로고침해도 입력 중이던 비용 항목과 참석자가 안전하게 복원됩니다.'
                },
                {
                    q: 'Q3. 모바일에서 다운로드한 엑셀 파일은 어디에 저장되나요?',
                    a: 'A: 스마트폰의 기본 [다운로드] 폴더(아이폰의 경우 파일 앱의 다운로드 폴더, 갤럭시는 내 파일의 다운로드)에 저장되며 카카오톡이나 사내 메일로 즉시 공유할 수 있습니다.'
                },
                {
                    q: 'Q4. 영수증 사진은 스마트폰 카메라로 바로 찍어 올릴 수 있나요?',
                    a: 'A: 네! [영수증 첨부] 버튼을 누르면 스마트폰 카메라가 즉시 실행되어 현장에서 영수증을 직접 촬영하여 바로 첨부할 수 있습니다.'
                }
            ];

            userFaqs.forEach((f, idx) => {
                const fx = 0.8 + (idx % 2) * 4.3;
                const fy = 1.35 + Math.floor(idx / 2) * 1.5;
                s9.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                    x: fx, y: fy, w: 4.1, h: 1.4,
                    fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                    rectRadius: 0.1
                });
                s9.addText([
                    { text: `${f.q}\n`, options: { bold: true, fontSize: 9.8, color: C.primary } },
                    { text: f.a, options: { fontSize: 8.5, color: '334155' } }
                ], {
                    x: fx + 0.18, y: fy + 0.14, w: 3.74, h: 1.15,
                    lineSpacing: 13, valign: 'top'
                });
            });

            // 하단 배너
            s9.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 0.8, y: 4.55, w: 8.4, h: 0.65,
                fill: { color: C.primaryLight }, line: { color: 'BFDBFE', width: 1 },
                rectRadius: 0.08
            });
            s9.addText('👏 모바일 정산 시스템과 함께 투명하고 즐거운 사내 동아리 활동을 만드세요!', {
                x: 1.0, y: 4.62, w: 8.0, h: 0.5,
                fontSize: 10.5, fontFace: FONT_TITLE, color: C.primaryDark, bold: true, align: 'center', valign: 'middle'
            });
        }

        const out = await pptx.write({ outputType: 'base64' });
        return out;
    }, images);

    await browser.close();

    const pptxBuffer = Buffer.from(pptxBase64, 'base64');
    const outFile = path.join(__dirname, '3M_사내_클럽_비용_정산_시스템_사용자_매뉴얼(모바일).pptx');
    fs.writeFileSync(outFile, pptxBuffer);
    console.log(`SUCCESS! Created Mobile User Manual PPTX at: ${outFile} (${(pptxBuffer.length / 1024).toFixed(1)} KB)`);
})();

