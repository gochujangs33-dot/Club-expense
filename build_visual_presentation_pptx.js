const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
    console.log('--- Building Visual Presentation PPTX in Clean Light Theme ---');
    const outDir = path.join(__dirname, 'ppt_screenshots');

    // 이미지 파일들을 base64로 로드
    const getImgBase64 = (filename) => {
        const p = path.join(outDir, filename);
        if (fs.existsSync(p)) {
            return fs.readFileSync(p).toString('base64');
        }
        console.warn(`File not found: ${filename}`);
        return null;
    };

    const images = {
        login: getImgBase64('01_login_pin.png'),
        register: getImgBase64('02_register.png'),
        header: getImgBase64('03_header_theme.png'),
        settleTab: getImgBase64('04_settlement_tab.png'),
        expenseForm: getImgBase64('05_expense_form.png'),
        rulesModal: getImgBase64('05_rules_modal.png'),
        settleResult: getImgBase64('06_settlement_result.png'),
        directory: getImgBase64('07_directory_tab.png'),
        dirSearch: getImgBase64('07_directory_search.png'),
        history: getImgBase64('08_history_tab.png'),
        adminDash: getImgBase64('09_admin_dashboard.png'),
        clubHistory: getImgBase64('10_club_history_tab.png'),
        charts: getImgBase64('11_charts_tab.png'),
        pptModal: getImgBase64('12_ppt_modal.png')
    };

    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle' });

    const pptxBase64 = await page.evaluate(async (imgs) => {
        const pptx = new window.PptxGenJS();
        pptx.layout = 'LAYOUT_16x9'; // 10 x 5.625 inches

        // 3M 엔터프라이즈 프리미엄 라이트 테마 컬러 팔레트
        const C = {
            bg: 'F8FAFC',              // 부드러운 슬레이트 라이트 배경
            cardBg: 'FFFFFF',          // 순백색 카드
            cardBorder: 'E2E8F0',      // 깔끔한 1px 연회색 테두리
            cardBorderStrong: 'CBD5E1',
            primary: '2563EB',         // 3M 로열 블루 액센트
            primaryLight: 'EFF6FF',    // 연한 블루 배경
            primaryDark: '1D4ED8',     // 진한 블루
            blue: '2563EB',
            blueLight: 'EFF6FF',
            emerald: '059669',         // 에메랄드 그린
            emeraldLight: 'ECFDF5',
            amber: 'D97706',           // 앰버 골드
            amberLight: 'FFFBEB',
            rose: 'E11D48',            // 로즈 레드
            roseLight: 'FFF1F2',
            purple: '7C3AED',          // 퍼플
            purpleLight: 'F5F3FF',
            textMain: '0F172A',        // 높은 시인성의 딥 슬레이트 텍스트
            textSub: '475569',         // 편안한 명도의 본문 텍스트
            textMuted: '64748B',       // 보조/푸터 텍스트
            white: 'FFFFFF'
        };

        const FONT_TITLE = 'Malgun Gothic';
        const FONT_BODY = 'Malgun Gothic';

        // 공통 슬라이드 템플릿 헤더 (라이트 테마)
        function createBaseSlide(title, subtitle, badgeText = '3M 사내 클럽 비용 정산 시스템') {
            const slide = pptx.addSlide();
            // 전체 배경
            slide.addShape(pptx.shapes.RECTANGLE, {
                x: 0, y: 0, w: 10, h: 5.625,
                fill: { color: C.bg }, line: { color: C.bg }
            });
            // 상단 얇은 블루 액센트 바
            slide.addShape(pptx.shapes.RECTANGLE, {
                x: 0, y: 0, w: 10, h: 0.08,
                fill: { color: C.primary }, line: { color: C.primary }
            });

            // 상단 시스템 배지
            slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 0.6, y: 0.28, w: 2.6, h: 0.32,
                fill: { color: C.primaryLight }, line: { color: 'BFDBFE', width: 1 },
                rectRadius: 0.08
            });
            slide.addText(badgeText, {
                x: 0.6, y: 0.28, w: 2.6, h: 0.32,
                fontSize: 9, fontFace: FONT_TITLE, color: C.primaryDark, bold: true, align: 'center', valign: 'middle',
                margin: 0
            });

            // 슬라이드 제목
            slide.addText(title, {
                x: 0.6, y: 0.62, w: 8.8, h: 0.42,
                fontSize: 18, fontFace: FONT_TITLE, color: C.textMain, bold: true, valign: 'middle',
                margin: 0
            });

            // 슬라이드 부제목 / 한줄 설명
            slide.addText(subtitle, {
                x: 0.6, y: 1.04, w: 8.8, h: 0.28,
                fontSize: 10.5, fontFace: FONT_BODY, color: C.textSub, valign: 'middle',
                margin: 0
            });

            // 하단 푸터 라인 및 저작권
            slide.addShape(pptx.shapes.LINE, {
                x: 0.6, y: 5.25, w: 8.8, h: 0,
                line: { color: 'E2E8F0', width: 0.8 }
            });
            slide.addText('3M 사내 동아리·클럽 비용 정산기 (v1.6.346) | 실무 사용자 설명회', {
                x: 0.6, y: 5.28, w: 6.0, h: 0.25,
                fontSize: 8, fontFace: FONT_BODY, color: C.textMuted, valign: 'middle',
                margin: 0
            });
            slide.addText('COPYRIGHT © 2026 3M ALL RIGHTS RESERVED', {
                x: 6.6, y: 5.28, w: 2.8, h: 0.25,
                fontSize: 7.5, fontFace: FONT_BODY, color: C.textMuted, align: 'right', valign: 'middle',
                margin: 0
            });

            return slide;
        }

        // =========================================================================
        // SLIDE 1: 표지 (Title Slide - Light Theme)
        // =========================================================================
        {
            const s1 = pptx.addSlide();
            s1.addShape(pptx.shapes.RECTANGLE, {
                x: 0, y: 0, w: 10, h: 5.625,
                fill: { color: C.bg }, line: { color: C.bg }
            });
            s1.addShape(pptx.shapes.RECTANGLE, {
                x: 0, y: 0, w: 10, h: 0.12,
                fill: { color: C.primary }, line: { color: C.primary }
            });

            // 로고 배지
            s1.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 1.0, y: 0.75, w: 2.8, h: 0.38,
                fill: { color: C.primaryLight }, line: { color: 'BFDBFE', width: 1.2 },
                rectRadius: 0.08
            });
            s1.addText('⚡ 3M SMART SETTLEMENT', {
                x: 1.0, y: 0.75, w: 2.8, h: 0.38,
                fontSize: 10.5, fontFace: FONT_TITLE, color: C.primaryDark, bold: true, align: 'center', valign: 'middle',
                margin: 0
            });

            // 메인 타이틀
            s1.addText('3M 사내 동아리·클럽\n비용 정산 시스템 사용자 설명회', {
                x: 1.0, y: 1.25, w: 8.0, h: 1.45,
                fontSize: 28, fontFace: FONT_TITLE, color: C.textMain, bold: true, lineSpacing: 40,
                margin: 0
            });

            // 서브 타이틀
            s1.addText('실제 사이트 화면으로 누구나 3분 만에 마스터하는 원클릭 스마트 정산 가이드', {
                x: 1.0, y: 2.80, w: 8.0, h: 0.38,
                fontSize: 12.5, fontFace: FONT_BODY, color: C.textSub,
                margin: 0
            });

            // 3대 핵심 혁신 카드 (라이트 카드)
            const kpis = [
                { title: '1초 간편 로그인', desc: '사번 PIN 번호로 비밀번호 없이 즉시 접속', color: C.primary, bg: C.primaryLight, icon: '🔑' },
                { title: '4구간 자동 분할', desc: '규정에 따른 회사 지원금/자부담 100% 자동 검증', color: C.emerald, bg: C.emeraldLight, icon: '⚡' },
                { title: '공식 엑셀 원클릭', desc: '회사 공식 품의서 서식 자동 매핑 및 즉시 다운로드', color: C.amber, bg: C.amberLight, icon: '📊' }
            ];

            kpis.forEach((k, idx) => {
                const kx = 1.0 + idx * 2.75;
                s1.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                    x: kx, y: 3.35, w: 2.55, h: 1.25,
                    fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                    rectRadius: 0.1
                });
                s1.addText(`${k.icon} ${k.title}`, {
                    x: kx + 0.18, y: 3.48, w: 2.2, h: 0.32,
                    fontSize: 12, fontFace: FONT_TITLE, color: k.color, bold: true, valign: 'middle',
                    margin: 0
                });
                s1.addText(k.desc, {
                    x: kx + 0.18, y: 3.86, w: 2.2, h: 0.62,
                    fontSize: 9.2, fontFace: FONT_BODY, color: C.textSub, lineSpacing: 14,
                    margin: 0
                });
            });

            // 하단 메타정보
            s1.addText('발표일: 2026. 11. 09  |  발표자: 김종필 (시스템 개발자)  |  시스템 버전: v1.6.346 (최신 정식 배포판)', {
                x: 1.0, y: 4.88, w: 8.0, h: 0.35,
                fontSize: 9.2, fontFace: FONT_BODY, color: C.textMuted,
                margin: 0
            });
        }

        // =========================================================================
        // SLIDE 2: 전체 프로세스 요약 (Process Roadmap - Light Theme)
        // =========================================================================
        {
            const s2 = createBaseSlide(
                '정산 전체 프로세스: 4단계 완성 로드맵',
                '복잡했던 서류 작성과 수기 계산 없이, 단 4단계 클릭만으로 공식 정산 품의가 완료됩니다.'
            );

            const steps = [
                { num: 'STEP 1', title: '간편 접속 & 로그인', desc: '사번 6자리 PIN 입력\n(신규 회원은 1초 등록)', tag: '로그인 모달', color: C.primary, lightBg: C.primaryLight },
                { num: 'STEP 2', title: '참석자 명부 담기', desc: '전사원 명부(1,317명) 검색\n[추가] 버튼 1클릭 반영', tag: '명부 연동', color: C.blue, lightBg: C.blueLight },
                { num: 'STEP 3', title: '비용 입력 & 자동계산', desc: '영수증 금액 및 카드 구분\n4구간 자부담 실시간 산출', tag: '실시간 검증', color: C.amber, lightBg: C.amberLight },
                { num: 'STEP 4', title: '1클릭 마감 & 엑셀', desc: '[정산 완료] 버튼 클릭 시\n공식 엑셀 품의서 즉시 다운', tag: '품의 완료', color: C.emerald, lightBg: C.emeraldLight }
            ];

            steps.forEach((st, idx) => {
                const sx = 0.6 + idx * 2.25;
                s2.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                    x: sx, y: 1.45, w: 2.12, h: 2.25,
                    fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                    rectRadius: 0.12
                });
                // 번호 배지
                s2.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                    x: sx + 0.16, y: 1.62, w: 0.95, h: 0.28,
                    fill: { color: st.lightBg }, line: { color: st.color, width: 0.8 },
                    rectRadius: 0.06
                });
                s2.addText(st.num, {
                    x: sx + 0.16, y: 1.62, w: 0.95, h: 0.28,
                    fontSize: 9, fontFace: FONT_TITLE, color: st.color, bold: true, align: 'center', valign: 'middle',
                    margin: 0
                });

                s2.addText(st.title, {
                    x: sx + 0.16, y: 2.02, w: 1.80, h: 0.40,
                    fontSize: 12, fontFace: FONT_TITLE, color: C.textMain, bold: true,
                    margin: 0
                });

                s2.addText(st.desc, {
                    x: sx + 0.16, y: 2.48, w: 1.80, h: 0.75,
                    fontSize: 9.5, fontFace: FONT_BODY, color: C.textSub, lineSpacing: 14.5,
                    margin: 0
                });

                // 태그 배지
                s2.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                    x: sx + 0.16, y: 3.32, w: 1.80, h: 0.26,
                    fill: { color: 'F8FAFC' }, line: { color: C.cardBorder, width: 0.8 },
                    rectRadius: 0.05
                });
                s2.addText(`✓ ${st.tag}`, {
                    x: sx + 0.16, y: 3.32, w: 1.80, h: 0.26,
                    fontSize: 8.5, fontFace: FONT_BODY, color: st.color, align: 'center', valign: 'middle',
                    margin: 0
                });
            });

            // 하단 비교 카드 (과거 vs 현재)
            s2.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 0.6, y: 3.90, w: 8.8, h: 1.15,
                fill: { color: C.primaryLight }, line: { color: 'BFDBFE', width: 1 },
                rectRadius: 0.1
            });
            s2.addText('💡 시스템 도입 전후 핵심 변화 비교', {
                x: 0.85, y: 4.02, w: 4.0, h: 0.26,
                fontSize: 11, fontFace: FONT_TITLE, color: C.primaryDark, bold: true,
                margin: 0
            });
            s2.addText('• 과거 방식: 엑셀 양식 수동 다운로드 ➔ 구간표 보고 계산기 두드리기 ➔ 동명이인/사번 수기 확인 ➔ 30분 이상 소요 및 계산 오류 빈발\n• 신규 시스템: 웹 접속 ➔ 참석자 클릭 ➔ 금액 입력 ➔ 4구간 자부담 & 공식 엑셀이 3분 안에 100% 무결점으로 자동 완성!', {
                x: 0.85, y: 4.32, w: 8.3, h: 0.62,
                fontSize: 9.0, fontFace: FONT_BODY, color: '1E293B', lineSpacing: 15,
                margin: 0
            });
        }

        // =========================================================================
        // SLIDE 3: Step 1. 로그인 및 회원가입
        // =========================================================================
        {
            const s3 = createBaseSlide(
                'Step 1. 1초 초간편 PIN 로그인 & 회원 등록',
                '아이디/비밀번호 분실 걱정 없이, 사번 뒷자리 6개 숫자로 모바일·PC 어디서나 즉시 접속합니다.'
            );

            // 좌측 실제 스크린샷 1 (로그인 키패드)
            if (imgs.login) {
                s3.addImage({
                    data: 'image/png;base64,' + imgs.login,
                    x: 0.6, y: 1.40, w: 1.75, h: 3.65
                });
            }

            // 가운데 좌측 실제 스크린샷 2 (회원 등록 화면)
            if (imgs.register) {
                s3.addImage({
                    data: 'image/png;base64,' + imgs.register,
                    x: 2.50, y: 1.40, w: 2.10, h: 3.10
                });
            }

            // 상단 헤더 화면
            if (imgs.header) {
                s3.addImage({
                    data: 'image/png;base64,' + imgs.header,
                    x: 2.50, y: 4.60, w: 2.10, h: 0.45
                });
            }

            // 우측: 상세 조작 설명 가이드 카드
            s3.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 4.75, y: 1.40, w: 4.65, h: 3.65,
                fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                rectRadius: 0.12
            });

            s3.addText('📱 조작 가이드 및 핵심 기능', {
                x: 5.0, y: 1.55, w: 4.15, h: 0.30,
                fontSize: 12.0, fontFace: FONT_TITLE, color: C.primary, bold: true,
                margin: 0
            });

            const guides3 = [
                { title: '① 6자리 사번 PIN 원터치 로그인', text: '화면 터치패드 또는 키보드로 본인의 6자리 PIN을 누르면 별도 엔터 없이 즉시 접속' },
                { title: '② 신규 회원 간편 등록 (최초 1회)', text: "처음 사용자는 '회원 등록하기'에서 이름과 사번 PIN(6자리)만 등록하면 즉시 완료" },
                { title: '③ 다크 / 라이트 모드 상시 지원', text: '우측 상단 토글 스위치로 주간/야간 어디서든 눈이 편안한 테마로 즉시 전환' }
            ];

            guides3.forEach((g, idx) => {
                const gy = 1.95 + idx * 0.74;
                s3.addText([
                    { text: `${g.title}\n`, options: { bold: true, fontSize: 10, color: C.textMain } },
                    { text: g.text, options: { fontSize: 8.5, color: C.textSub } }
                ], {
                    x: 5.0, y: gy, w: 4.15, h: 0.65,
                    margin: 0, lineSpacing: 13.5, valign: 'top'
                });
            });

            // 꿀팁 박스
            s3.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 5.0, y: 4.28, w: 4.15, h: 0.60,
                fill: { color: C.primaryLight }, line: { color: 'BFDBFE', width: 0.8 },
                rectRadius: 0.08
            });
            s3.addText('💡 모바일 앱 설치 팁: 스마트폰 브라우저에서 [홈 화면에 추가]를 누르면 별도 설치 없이 모바일 앱 아이콘으로 상시 원터치 실행됩니다.', {
                x: 5.15, y: 4.32, w: 3.85, h: 0.52,
                fontSize: 8.2, fontFace: FONT_BODY, color: C.primaryDark, lineSpacing: 12, valign: 'middle',
                margin: 0
            });
        }

        // =========================================================================
        // SLIDE 4: Step 2. 전사원 명부 검색 및 참석자 담기
        // =========================================================================
        {
            const s4 = createBaseSlide(
                'Step 2. 전사원 명부 실시간 검색 & 참석자 관리',
                '전사 1,316명 임직원 DB가 완벽 연동되어, 한 글자 입력만으로 초고속 실시간 검색 및 등록이 가능합니다.'
            );

            // 좌측 실제 스크린샷 (실시간 검색된 최신 화면 우선)
            const dirImg = imgs.dirSearch || imgs.directory;
            if (dirImg) {
                s4.addImage({
                    data: 'image/png;base64,' + dirImg,
                    x: 0.6, y: 1.40, w: 5.0, h: 3.65
                });
            }

            // 우측: 조작 가이드
            s4.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 5.8, y: 1.40, w: 3.6, h: 3.65,
                fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                rectRadius: 0.12
            });

            s4.addText('👥 참석자 및 명부 관리 핵심', {
                x: 6.0, y: 1.55, w: 3.2, h: 0.30,
                fontSize: 12.0, fontFace: FONT_TITLE, color: C.primary, bold: true,
                margin: 0
            });

            const guides4 = [
                { title: '① 전사 임직원 1,316명 DB 탑재', text: '사내 전 직원 이름과 사번이 등록되어 있어 오타나 누락 없이 정확하게 선택' },
                { title: '② 실시간 초성·이름·사번 검색 (NEW)', text: '초성 또는 이름 한 글자만 입력해도 즉시 필터링되며 검색 인원수가 분수로 표시' },
                { title: '③ 신규 사원 배지 & 참석 횟수 관리', text: '신규 등록 시 24시간 동안 배지 표시 및 연간 누적 참석 횟수 투명하게 자동 관리' },
                { title: '④ 동명이인 고유 사번 자동 식별', text: '이름이 같아도 고유 사번 기준으로 참석 횟수가 개별 관리되어 오귀속 원천 차단' }
            ];

            guides4.forEach((g, idx) => {
                const gy = 1.90 + idx * 0.60;
                s4.addText([
                    { text: `${g.title}\n`, options: { bold: true, fontSize: 10, color: C.textMain } },
                    { text: g.text, options: { fontSize: 8.5, color: C.textSub } }
                ], {
                    x: 6.0, y: gy, w: 3.2, h: 0.55,
                    margin: 0, lineSpacing: 13, valign: 'top'
                });
            });

            // 팁 박스
            s4.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 6.0, y: 4.42, w: 3.2, h: 0.48,
                fill: { color: C.emeraldLight }, line: { color: '#A7F3D0', width: 0.8 },
                rectRadius: 0.06
            });
            s4.addText('✓ 명부의 참석 인원수는 정산 탭에 실시간 자동 반영되어 1인당 비용을 오차 없이 계산합니다.', {
                x: 6.12, y: 4.45, w: 2.98, h: 0.42,
                fontSize: 8.0, fontFace: FONT_BODY, color: '#065F46', lineSpacing: 12, valign: 'middle',
                margin: 0
            });
        }

        // =========================================================================
        // SLIDE 5: Step 3. 비용 항목 입력 및 구분 & 정산 기준 안내 팝업 (v1.6.345 NEW)
        // =========================================================================
        {
            const s5 = createBaseSlide(
                'Step 3. 비용 항목 입력 & 실시간 정산 기준 안내 (NEW)',
                '금액 옆 [❓ 정산 기준] 버튼으로 4구간 누진 공식을 즉시 확인하고, 3대 카테고리 규정이 자동 적용됩니다.'
            );

            // 좌측 실제 스크린샷 1: 비용 입력 폼
            if (imgs.expenseForm) {
                s5.addImage({
                    data: 'image/png;base64,' + imgs.expenseForm,
                    x: 0.6, y: 1.40, w: 2.30, h: 3.65
                });
            }

            // 가운데 실제 스크린샷 2: [❓ 정산 기준] 클릭 시 나타나는 가/나/다/라 구간 안내 팝업
            if (imgs.rulesModal) {
                s5.addImage({
                    data: 'image/png;base64,' + imgs.rulesModal,
                    x: 3.02, y: 1.40, w: 2.35, h: 3.65
                });
            }

            // 우측: 3대 카테고리 규정 및 실시간 연동 설명 카드
            s5.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 5.50, y: 1.40, w: 3.90, h: 3.65,
                fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                rectRadius: 0.12
            });

            s5.addText('📋 비용 입력 핵심 & 정산 기준 안내', {
                x: 5.70, y: 1.55, w: 3.50, h: 0.30,
                fontSize: 12.0, fontFace: FONT_TITLE, color: C.amber, bold: true,
                margin: 0
            });

            const categories = [
                {
                    title: '① [❓ 정산 기준] 실시간 팝업 안내 (NEW)',
                    desc: '금액 입력란 옆 물음표 클릭 시 관리자 설정과 연동된 4구간 지원표와 초과 누진 계산법이 상세 예시와 함께 즉시 팝업 안내됩니다.'
                },
                {
                    title: '② 행사비: 인원수 비례 4구간 자동 분할',
                    desc: '참석자 1인당 행사비(=행사비÷인원) 기준 [가: 0% / 나: 20% / 다: 초과분 40% / 라: 85,000원 캡] 공식에 따라 회사 지원금과 자부담이 자동 산출됩니다.'
                },
                {
                    title: '③ 시설·장비 & 상품비 규정 자동 검증',
                    desc: '시설비는 인당 85,000원 한도 내 우선 지원되며, 상품비는 클럽당 연간 50만원 누적 한도를 실시간 감시하여 초과 등록을 원천 차단합니다.'
                }
            ];

            categories.forEach((c, idx) => {
                const cy = 1.95 + idx * 0.78;
                s5.addText([
                    { text: `${c.title}\n`, options: { bold: true, fontSize: 10, color: C.textMain } },
                    { text: c.desc, options: { fontSize: 8.5, color: C.textSub } }
                ], {
                    x: 5.70, y: cy, w: 3.50, h: 0.72,
                    margin: 0, lineSpacing: 13.5, valign: 'top'
                });
            });

            // 결제 수단 스위치 팁
            s5.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 5.70, y: 4.38, w: 3.50, h: 0.52,
                fill: { color: C.primaryLight }, line: { color: 'BFDBFE', width: 0.8 },
                rectRadius: 0.06
            });
            s5.addText('💳 결제 수단 스위치: [법인카드 / 개인카드] 토글 선택 시 회사 지원금과 개인 정산금이 100% 자동 분리 계산됩니다.', {
                x: 5.80, y: 4.40, w: 3.30, h: 0.48,
                fontSize: 8.2, fontFace: FONT_BODY, color: C.primaryDark, lineSpacing: 12, valign: 'middle',
                margin: 0
            });
        }

        // =========================================================================
        // SLIDE 6: Step 4. 자동 정산 결과 & 규정 검증
        // =========================================================================
        {
            const s6 = createBaseSlide(
                'Step 4. 실시간 자동 정산 결과 & 규정 100% 검증',
                '수기 계산 없이 4구간 자부담 공식과 잔여 예산 대조가 실시간으로 완벽하게 처리됩니다.'
            );

            // 좌측 실제 스크린샷
            if (imgs.settleResult) {
                s6.addImage({
                    data: 'image/png;base64,' + imgs.settleResult,
                    x: 0.6, y: 1.40, w: 2.7, h: 3.65
                });
            }

            // 우측 상단: 4구간 자부담 지원 규정표
            s6.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 3.5, y: 1.40, w: 5.9, h: 1.65,
                fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                rectRadius: 0.1
            });
            s6.addText('📊 3M 사내 동아리 4구간 지원 기준표 (규정 공식)', {
                x: 3.7, y: 1.50, w: 5.5, h: 0.26,
                fontSize: 11.5, fontFace: FONT_TITLE, color: C.primary, bold: true,
                margin: 0
            });

            const tiers = [
                { tier: '• 가 구간 (≤ 30,000원)', rate: '전액 지원 (자부담 0%)', formula: '지원금 = 비용 전액' },
                { tier: '• 나 구간 (≤ 60,000원)', rate: '일반 지원 (자부담 20%)', formula: '지원금 = 비용 × 80%' },
                { tier: '• 다 구간 (≤ 120,000원)', rate: '초과 누진 (초과분 40%)', formula: '자부담 = 6만×20% + 초과분×40%' },
                { tier: '• 라 구간 (> 120,000원)', rate: '한도 초과 (최대 85,000원 캡)', formula: '지원금 = 85,000원 고정 (초과 자부담)' }
            ];

            tiers.forEach((t, idx) => {
                const ty = 1.80 + idx * 0.28;
                s6.addText(t.tier, {
                    x: 3.7, y: ty, w: 2.2, h: 0.24,
                    fontSize: 8.8, fontFace: FONT_TITLE, color: C.textMain, bold: true,
                    margin: 0
                });
                s6.addText(t.rate, {
                    x: 5.9, y: ty, w: 1.6, h: 0.24,
                    fontSize: 8.8, fontFace: FONT_BODY, color: C.amber, bold: true,
                    margin: 0
                });
                s6.addText(t.formula, {
                    x: 7.5, y: ty, w: 1.8, h: 0.24,
                    fontSize: 8.2, fontFace: FONT_BODY, color: C.textSub,
                    margin: 0
                });
            });

            // 우측 하단: 실전 화면 결과 보는 법
            s6.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 3.5, y: 3.18, w: 5.9, h: 1.87,
                fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                rectRadius: 0.1
            });
            s6.addText('⚡ 실전 화면 결과 보는 법 (100% 자동 산출)', {
                x: 3.7, y: 3.28, w: 5.5, h: 0.26,
                fontSize: 11.5, fontFace: FONT_TITLE, color: C.emerald, bold: true,
                margin: 0
            });

            const resultPoints = [
                { name: '최종 지원금 (법인카드)', desc: '규정 한도 내에서 회사가 지급할 법인카드 총액' },
                { name: '인당 자부담 비용', desc: '참석자 1인당 계좌 입금 또는 현장 결제할 개인 부담금' },
                { name: '클럽 잔여 예산 실시간 차감', desc: '이번 지원금 반영 후 남은 클럽 잔여 예산 즉시 확인' },
                { name: '[정산 완료] 원클릭 마감', desc: '클릭 시 Firebase 공유 DB 저장 및 공식 엑셀 생성' }
            ];

            resultPoints.forEach((r, idx) => {
                const ry = 3.56 + idx * 0.34;
                s6.addText([
                    { text: `✓ ${r.name}:  `, options: { bold: true, fontSize: 8.8, color: C.primaryDark } },
                    { text: r.desc, options: { fontSize: 8.5, color: '334155' } }
                ], {
                    x: 3.7, y: ry, w: 5.5, h: 0.28,
                    margin: 0, valign: 'middle'
                });
            });
        }

        // =========================================================================
        // SLIDE 7: Step 5. 정산 이력 및 엑셀 재다운로드
        // =========================================================================
        {
            const s7 = createBaseSlide(
                'Step 5. 정산 이력 관리 & 공식 엑셀 품의서 원클릭 다운로드',
                '완료된 정산 내역이 투명하게 보관되며, 회사 공식 품의 엑셀을 언제든 재다운로드할 수 있습니다.'
            );

            // 좌측 실제 스크린샷
            if (imgs.history) {
                s7.addImage({
                    data: 'image/png;base64,' + imgs.history,
                    x: 0.6, y: 1.40, w: 5.2, h: 3.65
                });
            }

            // 우측: 상세 가이드
            s7.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 6.0, y: 1.40, w: 3.4, h: 3.65,
                fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                rectRadius: 0.12
            });

            s7.addText('📑 정산 이력 & 엑셀 다운로드', {
                x: 6.2, y: 1.55, w: 3.0, h: 0.30,
                fontSize: 12.0, fontFace: FONT_TITLE, color: C.emerald, bold: true,
                margin: 0
            });

            const guides7 = [
                { title: '① 클럽 예산 실시간 대시보드', text: '총 예산, 잔여 예산, 참석 인원, 상품비 누적액 상단 집계' },
                { title: '② 행사 날짜별 상세 내역 조회', text: '행사일, 참석 인원, 항목별 비용, 회사 지원금, 자부담 일목요연 정리' },
                { title: '③ 공식 품의 엑셀 즉시 다운로드', text: "초록색 [엑셀] 클릭 시 회사 공식 서식에 100% 매핑된 엑셀 파일 출력" },
                { title: '④ 투명한 이력 공유 및 보관', text: '일반 회원은 본인 작성 내역 확인, 관리자는 전사 집행 현황 검토' }
            ];

            guides7.forEach((g, idx) => {
                const gy = 1.90 + idx * 0.60;
                s7.addText([
                    { text: `${g.title}\n`, options: { bold: true, fontSize: 10, color: C.textMain } },
                    { text: g.text, options: { fontSize: 8.5, color: C.textSub } }
                ], {
                    x: 6.2, y: gy, w: 3.0, h: 0.55,
                    margin: 0, lineSpacing: 13, valign: 'top'
                });
            });

            // 엑셀 서식 안내 팁
            s7.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 6.2, y: 4.42, w: 3.0, h: 0.48,
                fill: { color: C.emeraldLight }, line: { color: '#A7F3D0', width: 0.8 },
                rectRadius: 0.06
            });
            s7.addText('✓ 엑셀 다운로드 시 K4~K30, L12~L25 등 회사 회계 제출용 좌표가 100% 자동 매핑됩니다.', {
                x: 6.3, y: 4.45, w: 2.8, h: 0.42,
                fontSize: 8.0, fontFace: FONT_BODY, color: '#065F46', lineSpacing: 12, valign: 'middle',
                margin: 0
            });
        }

        // =========================================================================
        // SLIDE 8: [관리자] 대시보드 관리 & 2열 레이아웃 & 작업 로그 (v1.6.346)
        // =========================================================================
        {
            const s8 = createBaseSlide(
                '[관리자] 대시보드 관리: 2열 레이아웃 & 작업 로그 최적화',
                '클럽 회장단 및 관리자(PIN: 000000)를 위한 전사 운영 현황, 2열 분할 레이아웃 및 최적화된 작업 감사 로그입니다.',
                '관리자 전용 기능 (회장단)'
            );

            // 좌측 실제 스크린샷
            if (imgs.adminDash) {
                s8.addImage({
                    data: 'image/png;base64,' + imgs.adminDash,
                    x: 0.6, y: 1.40, w: 5.1, h: 3.65
                });
            }

            // 우측: 관리자 핵심 기능
            s8.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 5.9, y: 1.40, w: 3.5, h: 3.65,
                fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                rectRadius: 0.12
            });

            s8.addText('👑 관리자 대시보드 핵심', {
                x: 6.1, y: 1.55, w: 3.1, h: 0.30,
                fontSize: 12.0, fontFace: FONT_TITLE, color: C.amber, bold: true,
                margin: 0
            });

            const guides8 = [
                { title: '① 전사 총괄 4대 KPI 실시간 타일', text: '등록 회원 수, 전체 누적 지출액, 회사 지원금, 임직원 자부담 종합 집계' },
                { title: '② 2열 독립 레이아웃 & 카드 접기 (NEW)', text: '좌측(클럽·예산) / 우측(정산 기준·데이터 관리) 2열 분할로 대화면 최적화' },
                { title: '③ 정산 구간 및 비율 전사 설정', text: '가/나/다/라 한도 및 비율 변경 시 전 사용자 화면에 실시간 동기화' },
                { title: '④ 전체 작업 로그 최적화 (v1.6.346)', text: '임시 로그는 제외하고 정산 확정·수정 및 데이터 변경만 투명하게 기록' }
            ];

            guides8.forEach((g, idx) => {
                const gy = 1.90 + idx * 0.60;
                s8.addText([
                    { text: `${g.title}\n`, options: { bold: true, fontSize: 10, color: C.textMain } },
                    { text: g.text, options: { fontSize: 8.5, color: C.textSub } }
                ], {
                    x: 6.1, y: gy, w: 3.1, h: 0.55,
                    margin: 0, lineSpacing: 13, valign: 'top'
                });
            });

            // 관리자 팁
            s8.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 6.1, y: 4.42, w: 3.1, h: 0.48,
                fill: { color: C.amberLight }, line: { color: '#FDE68A', width: 0.8 },
                rectRadius: 0.06
            });
            s8.addText('⚠️ 관리자 설정값은 모든 클럽 사용자에게 즉시 적용되며 Firebase 단일 기준으로 안전하게 동기화됩니다.', {
                x: 6.2, y: 4.45, w: 2.9, h: 0.42,
                fontSize: 8.0, fontFace: FONT_BODY, color: '#92400E', lineSpacing: 12, valign: 'middle',
                margin: 0
            });
        }

        // =========================================================================
        // SLIDE 9: [관리자] 클럽별 정산 이력 & 2x2 그리드 뷰 (v1.6.342)
        // =========================================================================
        {
            const s9 = createBaseSlide(
                '[관리자] 전사 클럽별 정산 이력: 2x2 와이드 그리드 & 다중 필터',
                '10개 클럽 집행 내역을 2x2 와이드 4분할 그리드로 한눈에 비교하고, 정산인·클럽별로 교차 검토합니다.',
                '관리자 전용 기능 (회장단)'
            );

            // 좌측 실제 스크린샷
            if (imgs.clubHistory) {
                s9.addImage({
                    data: 'image/png;base64,' + imgs.clubHistory,
                    x: 0.6, y: 1.40, w: 5.2, h: 3.65
                });
            }

            // 우측: 상세 가이드
            s9.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 6.0, y: 1.40, w: 3.4, h: 3.65,
                fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                rectRadius: 0.12
            });

            s9.addText('🔍 클럽별 이력 관리 핵심', {
                x: 6.2, y: 1.55, w: 3.0, h: 0.30,
                fontSize: 12.0, fontFace: FONT_TITLE, color: C.primary, bold: true,
                margin: 0
            });

            const guides9 = [
                { title: '① 2x2 와이드 4분할 그리드 뷰 (NEW)', text: "'전체 클럽' 모드에서 4분할 와이드 그리드로 여러 클럽 현황 동시 모니터링" },
                { title: '② 특정 클럽 단독 와이드 뷰', text: "상단 드롭다운에서 특정 클럽 선택 시 전체 폭(100%)으로 행사 내역 집중 조회" },
                { title: '③ 정산인(작성자) 스마트 필터링', text: '정산인이 2명 이상인 클럽은 자동 드롭다운이 노출되어 교차 검토 지원' },
                { title: '④ 모바일 요약 & 안전한 롤백', text: '모바일 전용 요일별 압축 요약 뷰 제공 및 삭제 시 전사 이력·카운트 완벽 롤백' }
            ];

            guides9.forEach((g, idx) => {
                const gy = 1.90 + idx * 0.60;
                s9.addText([
                    { text: `${g.title}\n`, options: { bold: true, fontSize: 10, color: C.textMain } },
                    { text: g.text, options: { fontSize: 8.5, color: C.textSub } }
                ], {
                    x: 6.2, y: gy, w: 3.0, h: 0.55,
                    margin: 0, lineSpacing: 13, valign: 'top'
                });
            });

            s9.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 6.2, y: 4.42, w: 3.0, h: 0.48,
                fill: { color: C.primaryLight }, line: { color: 'BFDBFE', width: 0.8 },
                rectRadius: 0.06
            });
            s9.addText('✓ 모든 이력 데이터는 Firebase 공유 DB에 실시간 동기화되어 데이터 분실 위험이 전혀 없습니다.', {
                x: 6.3, y: 4.45, w: 2.8, h: 0.42,
                fontSize: 8.0, fontFace: FONT_BODY, color: C.primaryDark, lineSpacing: 12, valign: 'middle',
                margin: 0
            });
        }

        // =========================================================================
        // SLIDE 10: [관리자] 7대 실시간 시각화 차트 대시보드
        // =========================================================================
        {
            const s10 = createBaseSlide(
                '[관리자] 7대 실시간 시각화 분석 차트 대시보드',
                '월별 지출액, 예산 소진율, 활동 회원 수 등 7대 핵심 지표를 인터랙티브 차트로 한눈에 파악합니다.',
                '관리자 전용 기능 (회장단)'
            );

            // 좌측 실제 스크린샷
            if (imgs.charts) {
                s10.addImage({
                    data: 'image/png;base64,' + imgs.charts,
                    x: 0.6, y: 1.40, w: 5.2, h: 3.65
                });
            }

            // 우측: 7대 분석 차트 안내
            s10.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 6.0, y: 1.40, w: 3.4, h: 3.65,
                fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                rectRadius: 0.12
            });

            s10.addText('📊 7대 실시간 분석 차트', {
                x: 6.2, y: 1.55, w: 3.0, h: 0.30,
                fontSize: 12.0, fontFace: FONT_TITLE, color: C.primary, bold: true,
                margin: 0
            });

            const chartsList = [
                { title: '① 월별 지출 현황 (1~12월)', desc: '클럽별 월간 지출액 추이를 멀티 컬러 바 차트로 비교 분석' },
                { title: '② 클럽별 예산 소진율 (위험도 경고)', desc: '클럽 고유 색상 매핑 및 소진율 위험도별 스마트 경고 표시' },
                { title: '③ 3대 비용 구성 비중 도넛 차트', desc: '행사비, 시설·장비, 상품비 구성비를 도넛 차트로 실시간 분석' },
                { title: '④ 클럽별 순수 참석자 분석 (중복 제거)', desc: '사번 기준 중복을 완벽 제거하여 실제 순수 활동 인원수 집계' },
                { title: '⑤ 정산 횟수 & 자부담 추이 분석', desc: '동아리별 정기 모임 활성화 수준과 임직원 자부담 변동성 모니터링' }
            ];

            chartsList.forEach((ch, idx) => {
                const cy = 1.90 + idx * 0.49;
                s10.addText([
                    { text: `${ch.title}\n`, options: { bold: true, fontSize: 9.5, color: C.textMain } },
                    { text: ch.desc, options: { fontSize: 8.0, color: C.textSub } }
                ], {
                    x: 6.2, y: cy, w: 3.0, h: 0.45,
                    margin: 0, lineSpacing: 12, valign: 'top'
                });
            });

            s10.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 6.2, y: 4.42, w: 3.0, h: 0.48,
                fill: { color: C.primaryLight }, line: { color: 'BFDBFE', width: 0.8 },
                rectRadius: 0.06
            });
            s10.addText('✓ 클럽 필터 칩으로 특정 클럽만 선택하여 비교하거나 [전체 선택]으로 전사 총괄 비교가 가능합니다.', {
                x: 6.3, y: 4.45, w: 2.8, h: 0.42,
                fontSize: 7.8, fontFace: FONT_BODY, color: C.primaryDark, lineSpacing: 11, valign: 'middle',
                margin: 0
            });
        }

        // =========================================================================
        // SLIDE 11: [관리자] 1클릭 연간 결산 PPT 보고서 자동 생성
        // =========================================================================
        {
            const s11 = createBaseSlide(
                '[관리자] 1클릭 연간 클럽 결산 PPT 보고서 자동 생성',
                '수작업으로 며칠씩 걸리던 경영진 연말 결산 보고서가 클릭 한 번에 16:9 와이드 PPTX로 자동 빌드됩니다.',
                '관리자 전용 기능 (회장단)'
            );

            // 좌측 실제 스크린샷
            if (imgs.pptModal) {
                s11.addImage({
                    data: 'image/png;base64,' + imgs.pptModal,
                    x: 0.6, y: 1.40, w: 2.8, h: 3.65
                });
            }

            // 우측: PPT 자동 생성 기능 명세
            s11.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 3.6, y: 1.40, w: 5.8, h: 3.65,
                fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                rectRadius: 0.12
            });

            s11.addText('🚀 연간 결산 PPT 자동화 3대 핵심 강점', {
                x: 3.8, y: 1.55, w: 5.4, h: 0.30,
                fontSize: 12.0, fontFace: FONT_TITLE, color: C.amber, bold: true,
                margin: 0
            });

            const pptSpecs = [
                {
                    title: '① 경영진 보고용 16:9 와이드 디자인 자동 적용',
                    desc: '표지, 전사 총괄 KPI 요약, 재원·용도 2대 도넛 차트, 소진율 바 차트, 10개 클럽 종합 비교표까지 풀 패키지 슬라이드 자동 생성'
                },
                {
                    title: '② 데이터 100% 실시간 동기화 및 오차 제로',
                    desc: '총 집행액, 연간 예산, 회사 지원금 비율, 임직원 자부담, 상품비 등 당일 최신 확정 데이터가 오차 없이 즉시 차트화'
                },
                {
                    title: '③ 즉시 편집 가능한 파워포인트 네이티브 파일',
                    desc: '단순 캡처 이미지가 아니라 파워포인트 도형, 표, 차트 객체로 생성되므로 다운로드 후 발표자가 자유롭게 추가 편집 가능'
                }
            ];

            pptSpecs.forEach((p, idx) => {
                const py = 1.95 + idx * 0.76;
                s11.addText([
                    { text: `${p.title}\n`, options: { bold: true, fontSize: 10, color: C.textMain } },
                    { text: p.desc, options: { fontSize: 8.5, color: C.textSub } }
                ], {
                    x: 3.8, y: py, w: 5.4, h: 0.70,
                    margin: 0, lineSpacing: 13, valign: 'top'
                });
            });

            // 다운로드 안내 배너
            s11.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 3.8, y: 4.38, w: 5.4, h: 0.52,
                fill: { color: C.amberLight }, line: { color: '#FDE68A', width: 1 },
                rectRadius: 0.08
            });
            s11.addText('📥 [PPTX 다운로드] 클릭 ➔ 3초 만에 파일 다운로드 완료! 연말 감사 및 예산 심의 보고 완벽 대응!', {
                x: 3.9, y: 4.40, w: 5.2, h: 0.48,
                fontSize: 9.0, fontFace: FONT_TITLE, color: '#92400E', bold: true, align: 'center', valign: 'middle',
                margin: 0
            });
        }

        // =========================================================================
        // SLIDE 12: FAQ & 엔딩 (Ending Slide - Light Theme)
        // =========================================================================
        {
            const s12 = pptx.addSlide();
            s12.addShape(pptx.shapes.RECTANGLE, {
                x: 0, y: 0, w: 10, h: 5.625,
                fill: { color: C.bg }, line: { color: C.bg }
            });
            s12.addShape(pptx.shapes.RECTANGLE, {
                x: 0, y: 0, w: 10, h: 0.12,
                fill: { color: C.primary }, line: { color: C.primary }
            });

            // 제목
            s12.addText('자주 묻는 질문 (FAQ) & 클럽 운영 지원 안내', {
                x: 0.6, y: 0.42, w: 8.8, h: 0.38,
                fontSize: 18, fontFace: FONT_TITLE, color: C.textMain, bold: true,
                margin: 0
            });
            s12.addText('정산 시스템 사용 중 궁금한 점과 특수 상황 처리 방법입니다.', {
                x: 0.6, y: 0.82, w: 8.8, h: 0.26,
                fontSize: 10.5, fontFace: FONT_BODY, color: C.textSub,
                margin: 0
            });

            const faqs = [
                {
                    q: 'Q1. 인당 지원 한도(85,000원)를 초과하는 특별 행사는?',
                    a: 'A: 관리자가 클럽 관리 메뉴에서 [1회성 초과 지원 승인] 토글을 활성화하면 잔여 예산 내에서 최대치 정산이 가능합니다 (정산 확정 시 1회 사용 후 자동 리셋).'
                },
                {
                    q: 'Q2. 실제 영수증 상황에 맞춰 자부담 금액을 수동 수정할 수 있나요?',
                    a: 'A: 네! 결과 카드의 [총 자부담 금액 (수정 가능)] 입력창에 원하는 금액을 입력하시면 수동 입력값이 최우선 반영되어 최종 지원금이 자동 재조정됩니다.'
                },
                {
                    q: 'Q3. 모바일 스마트폰에서도 컴퓨터와 똑같이 사용할 수 있나요?',
                    a: 'A: 100% 동일합니다. 반응형 모바일 PWA로 개발되어 스마트폰 화면에서도 터치 키패드, 명부 검색, 엑셀 다운로드가 원활하게 동작합니다.'
                },
                {
                    q: 'Q4. 새해가 되면 전사원 명부의 참석 횟수는 삭제되나요?',
                    a: 'A: 삭제되지 않습니다! 매년 1월 1일 직전 연도 카운트는 연도별 히스토리로 안전하게 영구 보관된 후 새해 카운트만 0회로 자동 리셋됩니다.'
                }
            ];

            faqs.forEach((f, idx) => {
                const fx = 0.6 + (idx % 2) * 4.5;
                const fy = 1.20 + Math.floor(idx / 2) * 1.55;
                s12.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                    x: fx, y: fy, w: 4.3, h: 1.45,
                    fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                    rectRadius: 0.1
                });
                s12.addText([
                    { text: `${f.q}\n`, options: { bold: true, fontSize: 9.8, color: C.primary } },
                    { text: f.a, options: { fontSize: 8.5, color: '334155' } }
                ], {
                    x: fx + 0.18, y: fy + 0.14, w: 3.94, h: 1.18,
                    margin: 0, lineSpacing: 13.5, valign: 'top'
                });
            });

            // 하단 땡큐 배너 (라이트 테마)
            s12.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 0.6, y: 4.45, w: 8.8, h: 0.75,
                fill: { color: C.primaryLight }, line: { color: 'BFDBFE', width: 1.2 },
                rectRadius: 0.1
            });
            s12.addText('👏 경청해 주셔서 감사합니다! 즐겁고 투명한 사내 동아리 활동을 응원합니다.', {
                x: 0.85, y: 4.55, w: 6.0, h: 0.30,
                fontSize: 11.5, fontFace: FONT_TITLE, color: C.primaryDark, bold: true,
                margin: 0
            });
            s12.addText('시스템 문의 및 신규 동아리 등록 신청: 김종필 (사내 메신저 / 시스템 개발 담당)', {
                x: 0.85, y: 4.88, w: 6.0, h: 0.24,
                fontSize: 9.0, fontFace: FONT_BODY, color: C.primary,
                margin: 0
            });
            s12.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 7.2, y: 4.58, w: 2.0, h: 0.48,
                fill: { color: C.primary }, line: { color: C.primary, width: 1 },
                rectRadius: 0.08
            });
            s12.addText('⚡ 지금 바로 시작하기', {
                x: 7.2, y: 4.58, w: 2.0, h: 0.48,
                fontSize: 10, fontFace: FONT_TITLE, color: C.white, bold: true, align: 'center', valign: 'middle',
                margin: 0
            });
        }

        // 빌드 및 base64 반환
        return await pptx.write('base64');
    }, images);

    await browser.close();

    const outPath = path.join(__dirname, '3M_사내_클럽_비용_정산_시스템_사용_설명회.pptx');
    fs.writeFileSync(outPath, Buffer.from(pptxBase64, 'base64'));
    const stats = fs.statSync(outPath);
    console.log(`SUCCESS! Created Light Theme Visual PPTX at: ${outPath} (${(stats.size / 1024).toFixed(1)} KB)`);
})();
