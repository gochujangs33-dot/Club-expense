const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
    console.log('--- Building Visual Presentation PPTX with Real Screenshots ---');
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
        settleResult: getImgBase64('06_settlement_result.png'),
        directory: getImgBase64('07_directory_tab.png'),
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
        pptx.layout = 'LAYOUT_16x9'; // 10 x 5.625 inches (또는 13.33 x 7.5)
        // 기본 16:9 사이즈는 10 x 5.625 inches (pptxgen 기본)

        const C = {
            bg: '0F172A',         // 슬레이트 다크
            cardBg: '1E293B',     // 카드 배경
            cardBorder: '334155', // 테두리
            primary: '8B5CF6',    // 바이올렛 액센트
            primaryLight: 'C4B5FD',
            blue: '3B82F6',       // 블루
            emerald: '10B981',    // 에메랄드 그린
            amber: 'F59E0B',      // 앰버 골드
            rose: 'F43F5E',       // 로즈 레드
            textMain: 'F8FAFC',   // 화이트 텍스트
            textSub: '94A3B8',    // 회색 텍스트
            white: 'FFFFFF'
        };

        const FONT_TITLE = 'Malgun Gothic';
        const FONT_BODY = 'Malgun Gothic';

        // 공통 슬라이드 템플릿 헤더
        function createBaseSlide(title, subtitle, badgeText = '3M 사내 클럽 비용 정산 시스템') {
            const slide = pptx.addSlide();
            // 배경
            slide.addShape(pptx.shapes.RECTANGLE, {
                x: 0, y: 0, w: 10, h: 5.625,
                fill: { color: C.bg }, line: { color: C.bg }
            });
            // 상단 얇은 컬러 바
            slide.addShape(pptx.shapes.RECTANGLE, {
                x: 0, y: 0, w: 10, h: 0.08,
                fill: { color: C.primary }, line: { color: C.primary }
            });

            // 상단 배지
            slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 0.6, y: 0.28, w: 2.5, h: 0.32,
                fill: { color: '2E1065' }, line: { color: C.primary, width: 1 },
                rectRadius: 0.08
            });
            slide.addText(badgeText, {
                x: 0.6, y: 0.28, w: 2.5, h: 0.32,
                fontSize: 9, fontFace: FONT_TITLE, color: C.primaryLight, bold: true, align: 'center', valign: 'middle'
            });

            // 슬라이드 제목
            slide.addText(title, {
                x: 0.6, y: 0.62, w: 8.8, h: 0.45,
                fontSize: 18, fontFace: FONT_TITLE, color: C.textMain, bold: true, valign: 'middle'
            });

            // 슬라이드 부제목/한줄설명
            slide.addText(subtitle, {
                x: 0.6, y: 1.05, w: 8.8, h: 0.28,
                fontSize: 10.5, fontFace: FONT_BODY, color: C.textSub, valign: 'middle'
            });

            // 하단 푸터 라인
            slide.addShape(pptx.shapes.LINE, {
                x: 0.6, y: 5.25, w: 8.8, h: 0,
                line: { color: '334155', width: 0.8 }
            });
            slide.addText('3M 사내 동아리·클럽 비용 정산기 (v1.6.306) | 실무 사용자 설명회', {
                x: 0.6, y: 5.28, w: 6.0, h: 0.25,
                fontSize: 8, fontFace: FONT_BODY, color: '64748B', valign: 'middle'
            });
            slide.addText('COPYRIGHT © 2026 3M ALL RIGHTS RESERVED', {
                x: 6.6, y: 5.28, w: 2.8, h: 0.25,
                fontSize: 7.5, fontFace: FONT_BODY, color: '64748B', align: 'right', valign: 'middle'
            });

            return slide;
        }

        // =========================================================================
        // SLIDE 1: 표지 (Title)
        // =========================================================================
        {
            const s1 = pptx.addSlide();
            s1.addShape(pptx.shapes.RECTANGLE, {
                x: 0, y: 0, w: 10, h: 5.625,
                fill: { color: C.bg }, line: { color: C.bg }
            });
            // 상단 액센트 라인
            s1.addShape(pptx.shapes.RECTANGLE, {
                x: 0, y: 0, w: 10, h: 0.12,
                fill: { color: C.primary }, line: { color: C.primary }
            });

            // 로고 배지
            s1.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 1.0, y: 0.8, w: 2.6, h: 0.42,
                fill: { color: '2E1065' }, line: { color: C.primary, width: 1.2 },
                rectRadius: 0.1
            });
            s1.addText('⚡ 3M SMART SETTLEMENT', {
                x: 1.0, y: 0.8, w: 2.6, h: 0.42,
                fontSize: 11, fontFace: FONT_TITLE, color: C.primaryLight, bold: true, align: 'center', valign: 'middle'
            });

            // 메인 타이틀
            s1.addText('3M 사내 동아리·클럽\n비용 정산 시스템 사용자 설명회', {
                x: 1.0, y: 1.35, w: 8.0, h: 1.4,
                fontSize: 28, fontFace: FONT_TITLE, color: C.textMain, bold: true, lineSpacing: 38
            });

            // 서브 타이틀
            s1.addText('실제 사이트 화면으로 누구나 3분 만에 마스터하는 원클릭 스마트 정산 가이드', {
                x: 1.0, y: 2.85, w: 8.0, h: 0.4,
                fontSize: 13, fontFace: FONT_BODY, color: C.textSub
            });

            // 3대 핵심 혁신 카드
            const kpis = [
                { title: '1초 간편 로그인', desc: '사번 PIN 번호로 비밀번호 없이 즉시 접속', color: C.primary, icon: '🔑' },
                { title: '4구간 자동 분할', desc: '규정에 따른 회사 지원금/자부담 100% 자동 검증', color: C.blue, icon: '⚡' },
                { title: '공식 엑셀 원클릭', desc: '회사 공식 품의서 서식 자동 매핑 및 즉시 다운로드', color: C.emerald, icon: '📊' }
            ];

            kpis.forEach((k, idx) => {
                const kx = 1.0 + idx * 2.75;
                s1.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                    x: kx, y: 3.4, w: 2.55, h: 1.15,
                    fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                    rectRadius: 0.1
                });
                s1.addText(`${k.icon} ${k.title}`, {
                    x: kx + 0.15, y: 3.5, w: 2.25, h: 0.35,
                    fontSize: 12, fontFace: FONT_TITLE, color: k.color, bold: true, valign: 'middle'
                });
                s1.addText(k.desc, {
                    x: kx + 0.15, y: 3.88, w: 2.25, h: 0.55,
                    fontSize: 9.5, fontFace: FONT_BODY, color: C.textSub, lineSpacing: 13
                });
            });

            // 하단 메타정보
            s1.addText('발표일: 2026. 10. 24 (금)  |  발표자: 김종필 (시스템 개발자)  |  시스템 버전: v1.6.306 (최신 안정화 버전)', {
                x: 1.0, y: 4.85, w: 8.0, h: 0.35,
                fontSize: 9.5, fontFace: FONT_BODY, color: '64748B'
            });
        }

        // =========================================================================
        // SLIDE 2: 전체 프로세스 요약 (Process Roadmap)
        // =========================================================================
        {
            const s2 = createBaseSlide(
                '정산 전체 프로세스: 4단계 완성 로드맵',
                '복잡했던 서류 작성과 수기 계산 없이, 단 4단계 클릭만으로 공식 정산 품의가 완료됩니다.'
            );

            const steps = [
                { num: 'STEP 1', title: '간편 접속 & 로그인', desc: '사번 6자리 PIN 입력\n(신규 회원은 1초 등록)', tag: '로그인 모달', color: C.primary },
                { num: 'STEP 2', title: '참석자 명부 담기', desc: '전사원 명부(1,317명) 검색\n[추가] 버튼 1클릭 반영', tag: '명부 연동', color: C.blue },
                { num: 'STEP 3', title: '비용 입력 & 자동계산', desc: '영수증 금액 및 카드 구분\n4구간 자부담 실시간 산출', tag: '실시간 검증', color: C.amber },
                { num: 'STEP 4', title: '1클릭 마감 & 엑셀', desc: '[정산 완료] 버튼 클릭 시\n공식 엑셀 품의서 즉시 다운', tag: '품의 완료', color: C.emerald }
            ];

            steps.forEach((st, idx) => {
                const sx = 0.6 + idx * 2.25;
                s2.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                    x: sx, y: 1.5, w: 2.1, h: 2.3,
                    fill: { color: C.cardBg }, line: { color: st.color, width: 1.2 },
                    rectRadius: 0.12
                });
                // 번호 배지
                s2.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                    x: sx + 0.15, y: 1.68, w: 1.0, h: 0.3,
                    fill: { color: '0F172A' }, line: { color: st.color, width: 1 },
                    rectRadius: 0.06
                });
                s2.addText(st.num, {
                    x: sx + 0.15, y: 1.68, w: 1.0, h: 0.3,
                    fontSize: 9, fontFace: FONT_TITLE, color: st.color, bold: true, align: 'center', valign: 'middle'
                });

                s2.addText(st.title, {
                    x: sx + 0.15, y: 2.1, w: 1.8, h: 0.45,
                    fontSize: 12.5, fontFace: FONT_TITLE, color: C.textMain, bold: true
                });

                s2.addText(st.desc, {
                    x: sx + 0.15, y: 2.6, w: 1.8, h: 0.8,
                    fontSize: 10, fontFace: FONT_BODY, color: C.textSub, lineSpacing: 14
                });

                // 태그 배지
                s2.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                    x: sx + 0.15, y: 3.42, w: 1.8, h: 0.26,
                    fill: { color: '0F172A' }, line: { color: C.cardBorder, width: 0.8 },
                    rectRadius: 0.05
                });
                s2.addText(`✓ ${st.tag}`, {
                    x: sx + 0.15, y: 3.42, w: 1.8, h: 0.26,
                    fontSize: 8.5, fontFace: FONT_BODY, color: st.color, align: 'center', valign: 'middle'
                });
            });

            // 하단 비교 카드 (과거 vs 현재)
            s2.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 0.6, y: 4.0, w: 8.8, h: 1.05,
                fill: { color: '172554' }, line: { color: C.blue, width: 1 },
                rectRadius: 0.1
            });
            s2.addText('💡 시스템 도입 전후 핵심 변화 비교', {
                x: 0.8, y: 4.1, w: 4.0, h: 0.28,
                fontSize: 11, fontFace: FONT_TITLE, color: C.primaryLight, bold: true
            });
            s2.addText('• 과거 방식: 엑셀 양식 수동 다운로드 ➔ 구간표 보고 계산기 두드리기 ➔ 동명이인/사번 수기 확인 ➔ 30분 이상 소요 및 계산 오류 빈발\n• 신규 시스템: 웹 접속 ➔ 참석자 클릭 ➔ 금액 입력 ➔ 4구간 자부담 & 공식 엑셀이 3분 안에 100% 무결점으로 자동 완성!', {
                x: 0.8, y: 4.38, w: 8.4, h: 0.6,
                fontSize: 9.5, fontFace: FONT_BODY, color: C.textMain, lineSpacing: 14
            });
        }

        // =========================================================================
        // SLIDE 3: Step 1. 로그인 및 회원가입 (실화면 01_login_pin, 02_register, 03_header)
        // =========================================================================
        {
            const s3 = createBaseSlide(
                'Step 1. 1초 초간편 PIN 로그인 & 회원 등록',
                '아이디/비밀번호 분실 걱정 없이, 사번 뒷자리 6개 숫자로 모바일·PC 어디서나 즉시 접속합니다.'
            );

            // 좌측: 실제 스크린샷 1 (로그인 키패드)
            if (imgs.login) {
                s3.addImage({
                    data: 'image/png;base64,' + imgs.login,
                    x: 0.6, y: 1.45, w: 1.7, h: 3.55
                });
            }

            // 가운데 좌측: 실제 스크린샷 2 (회원 등록 화면)
            if (imgs.register) {
                s3.addImage({
                    data: 'image/png;base64,' + imgs.register,
                    x: 2.45, y: 1.45, w: 2.1, h: 3.0
                });
            }

            // 상단 헤더 화면
            if (imgs.header) {
                s3.addImage({
                    data: 'image/png;base64,' + imgs.header,
                    x: 2.45, y: 4.55, w: 2.1, h: 0.45
                });
            }

            // 우측: 상세 조작 설명 가이드 카드
            s3.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 4.75, y: 1.45, w: 4.65, h: 3.55,
                fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                rectRadius: 0.12
            });

            s3.addText('📱 조작 가이드 및 핵심 기능', {
                x: 5.0, y: 1.6, w: 4.15, h: 0.35,
                fontSize: 13, fontFace: FONT_TITLE, color: C.primary, bold: true
            });

            const guides3 = [
                { no: '①', title: '6자리 사번 PIN 원터치 로그인', text: '화면 터치패드 또는 키보드로 본인의 6자리 PIN을 누르면 별도 엔터 없이 즉시 메인 화면으로 이동합니다.' },
                { no: '②', title: '신규 회원 1회 등록 (30초)', text: "처음 사용자는 하단 '회원 등록하기'를 눌러 이름과 6자리 PIN(사번 CG001234인 경우 '001234')만 등록하면 완료됩니다." },
                { no: '③', title: '다크 / 라이트 모드 상시 지원', text: '상단 우측 [Dark / Light] 토글 스위치로 야간이나 주간 어디서든 눈이 편안한 테마로 즉시 전환됩니다.' }
            ];

            guides3.forEach((g, idx) => {
                const gy = 2.05 + idx * 0.72;
                s3.addText(`${g.no} ${g.title}`, {
                    x: 5.0, y: gy, w: 4.15, h: 0.26,
                    fontSize: 10.5, fontFace: FONT_TITLE, color: C.textMain, bold: true
                });
                s3.addText(g.text, {
                    x: 5.25, y: gy + 0.24, w: 3.9, h: 0.42,
                    fontSize: 9.2, fontFace: FONT_BODY, color: C.textSub, lineSpacing: 13
                });
            });

            // 꿀팁 박스
            s3.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 5.0, y: 4.28, w: 4.15, h: 0.6,
                fill: { color: '172554' }, line: { color: C.blue, width: 0.8 },
                rectRadius: 0.08
            });
            s3.addText('💡 모바일 PWA 앱 설치 팁: 스마트폰 브라우저에서 [홈 화면에 추가]를 누르면 앱스토어 설치 없이 스마트폰 앱 아이콘으로 상시 원터치 실행됩니다.', {
                x: 5.15, y: 4.33, w: 3.85, h: 0.5,
                fontSize: 8.5, fontFace: FONT_BODY, color: C.textMain, lineSpacing: 12
            });
        }

        // =========================================================================
        // SLIDE 4: Step 2. 전사원 명부 검색 및 참석자 담기 (07_directory_tab)
        // =========================================================================
        {
            const s4 = createBaseSlide(
                'Step 2. 전사원 명부 검색 & 참석자 원클릭 담기',
                '전사 1,317명 임직원 DB가 완벽 연동되어, 오타나 동명이인 착오 없이 정확하게 참석자를 등록합니다.'
            );

            // 좌측: 실제 스크린샷 (전사원 명부 탭)
            if (imgs.directory) {
                s4.addImage({
                    data: 'image/png;base64,' + imgs.directory,
                    x: 0.6, y: 1.45, w: 5.0, h: 3.55
                });
            }

            // 우측: 조작 가이드
            s4.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 5.8, y: 1.45, w: 3.6, h: 3.55,
                fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                rectRadius: 0.12
            });

            s4.addText('👥 참석자 관리 3대 핵심 포인트', {
                x: 6.0, y: 1.6, w: 3.2, h: 0.35,
                fontSize: 13, fontFace: FONT_TITLE, color: C.blue, bold: true
            });

            const guides4 = [
                { no: '①', title: '전사 임직원 1,317명 완벽 탑재', text: '사내 전 직원의 이름과 사번(EMP ID)이 사전 등록되어 있어 이름이나 사번 검색으로 즉시 조회됩니다.' },
                { no: '②', title: '[추가] 버튼 1클릭으로 반영', text: "검색된 사원 옆의 [추가] 버튼을 누르면 즉시 '✓ 추가됨'으로 변경되며 현재 정산 참석자 명단에 자동 등록됩니다." },
                { no: '③', title: '올해 누적 참석 횟수 자동 표시', text: "'홍준영(올해 누적: 17회)'처럼 연간 참여 횟수가 자동 표시되어 공평한 활동 기회 및 회비 분배가 가능합니다." },
                { no: '④', title: '동명이인 사번 완벽 식별', text: '이진호(4035) 등 동명이인이 존재해도 고유 사번 기준으로 참석 횟수가 독립 관리되어 오귀속이 원천 차단됩니다.' }
            ];

            guides4.forEach((g, idx) => {
                const gy = 2.05 + idx * 0.64;
                s4.addText(`${g.no} ${g.title}`, {
                    x: 6.0, y: gy, w: 3.2, h: 0.24,
                    fontSize: 10, fontFace: FONT_TITLE, color: C.textMain, bold: true
                });
                s4.addText(g.text, {
                    x: 6.25, y: gy + 0.22, w: 2.95, h: 0.38,
                    fontSize: 8.8, fontFace: FONT_BODY, color: C.textSub, lineSpacing: 12
                });
            });

            // 팁
            s4.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 6.0, y: 4.5, w: 3.2, h: 0.42,
                fill: { color: '064E3B' }, line: { color: C.emerald, width: 0.8 },
                rectRadius: 0.06
            });
            s4.addText('✓ 명부에서 선택된 인원수는 정산 탭에 실시간 자동 반영되어 1인당 비용을 자동 나눗셈합니다.', {
                x: 6.1, y: 4.53, w: 3.0, h: 0.36,
                fontSize: 8.2, fontFace: FONT_BODY, color: '#A7F3D0', lineSpacing: 11
            });
        }

        // =========================================================================
        // SLIDE 5: Step 3. 비용 항목 입력 및 구분 (05_expense_form + 04_settlement_tab)
        // =========================================================================
        {
            const s5 = createBaseSlide(
                'Step 3. 비용 항목 추가 & 3대 카테고리 규정 분류',
                '식대, 장비 대관료, 상품비 등 항목별 특성에 맞춰 최적의 지원 규정이 자동으로 적용됩니다.'
            );

            // 좌측: 실제 스크린샷 (비용 항목 추가 카드)
            if (imgs.expenseForm) {
                s5.addImage({
                    data: 'image/png;base64,' + imgs.expenseForm,
                    x: 0.6, y: 1.45, w: 3.4, h: 3.55
                });
            }

            // 우측: 3대 카테고리 규정 설명 카드
            s5.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 4.2, y: 1.45, w: 5.2, h: 3.55,
                fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                rectRadius: 0.12
            });

            s5.addText('📋 비용 입력 방법 및 3대 카테고리 규정', {
                x: 4.4, y: 1.6, w: 4.8, h: 0.35,
                fontSize: 13, fontFace: FONT_TITLE, color: C.amber, bold: true
            });

            const categories = [
                {
                    name: '① 행사비 (식대, 다과비 등)',
                    badge: '인원수 비례 4구간 분할',
                    badgeColor: C.primary,
                    desc: '참석자 1인당 비용으로 자동 환산되어 [가/나/다/라] 4단계 규정 구간에 따라 회사 지원금과 자부담으로 정밀 분할됩니다.'
                },
                {
                    name: '② 시설 및 장비 (대관료, 장비 렌탈)',
                    badge: '인당 85,000원 Flat 한도',
                    badgeColor: C.blue,
                    desc: '인원수와 무관한 정액 비용 특성을 반영하여, 인당 85,000원 × 인원수 한도 내에서 전액 법인카드로 우선 지원 제안됩니다.'
                },
                {
                    name: '③ 상품비 (기념품, 시상품)',
                    badge: '연간 50만원 한도 실시간 감시',
                    badgeColor: C.rose,
                    desc: '동아리당 연간 총 상품비 누적 한도(500,000원)를 실시간 감시하며, 잔여 한도 초과 시 자동으로 등록이 차단됩니다.'
                }
            ];

            categories.forEach((c, idx) => {
                const cy = 2.02 + idx * 0.78;
                s5.addText(c.name, {
                    x: 4.4, y: cy, w: 3.0, h: 0.24,
                    fontSize: 10.5, fontFace: FONT_TITLE, color: C.textMain, bold: true
                });
                s5.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                    x: 7.2, y: cy, w: 2.0, h: 0.22,
                    fill: { color: '0F172A' }, line: { color: c.badgeColor, width: 0.8 },
                    rectRadius: 0.05
                });
                s5.addText(c.badge, {
                    x: 7.2, y: cy, w: 2.0, h: 0.22,
                    fontSize: 7.5, fontFace: FONT_BODY, color: c.badgeColor, align: 'center', valign: 'middle'
                });
                s5.addText(c.desc, {
                    x: 4.6, y: cy + 0.24, w: 4.6, h: 0.44,
                    fontSize: 8.8, fontFace: FONT_BODY, color: C.textSub, lineSpacing: 12
                });
            });

            // 결제 수단 스위치 팁
            s5.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 4.4, y: 4.4, w: 4.8, h: 0.5,
                fill: { color: '312E81' }, line: { color: C.primary, width: 0.8 },
                rectRadius: 0.06
            });
            s5.addText('💳 결제 수단 간편 스위치: 상단 [법인카드 / 개인카드] 토글 스위치로 결제 방식을 선택하면, 회사 지원금과 개인 정산금이 100% 자동 분리됩니다.', {
                x: 4.5, y: 4.43, w: 4.6, h: 0.44,
                fontSize: 8.3, fontFace: FONT_BODY, color: C.primaryLight, lineSpacing: 11
            });
        }

        // =========================================================================
        // SLIDE 6: Step 4. 자동 정산 결과 & 규정 검증 (06_settlement_result)
        // =========================================================================
        {
            const s6 = createBaseSlide(
                'Step 4. 실시간 자동 정산 결과 & 규정 100% 검증',
                '계산기나 수기 검토 없이, 4구간 자부담 공식과 잔여 예산 대조가 실시간으로 완벽하게 처리됩니다.'
            );

            // 좌측: 실제 스크린샷 (자동 정산 결과 카드)
            if (imgs.settleResult) {
                s6.addImage({
                    data: 'image/png;base64,' + imgs.settleResult,
                    x: 0.6, y: 1.45, w: 2.7, h: 3.55
                });
            }

            // 우측 상단: 4구간 자부담 지원 규정표
            s6.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 3.5, y: 1.45, w: 5.9, h: 1.7,
                fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                rectRadius: 0.1
            });
            s6.addText('📊 3M 사내 동아리 4구간 지원 기준표 (규정 공식)', {
                x: 3.7, y: 1.55, w: 5.5, h: 0.28,
                fontSize: 11, fontFace: FONT_TITLE, color: C.primary, bold: true
            });

            const tiers = [
                { tier: '가 구간 (≤ 30,000원)', rate: '자부담 0% (전액 지원)', formula: '지원금 = 비용 전액' },
                { tier: '나 구간 (≤ 60,000원)', rate: '자부담 20%', formula: '지원금 = 비용 × 80%' },
                { tier: '다 구간 (≤ 120,000원)', rate: '6만원 초과분 40%', formula: '자부담 = 6만×20% + 초과분×40%' },
                { tier: '라 구간 (> 120,000원)', rate: '인당 최대 85,000원 캡', formula: '지원금 = 85,000원 고정 (초과 전액 자부담)' }
            ];

            tiers.forEach((t, idx) => {
                const ty = 1.88 + idx * 0.29;
                s6.addText(`• ${t.tier}`, {
                    x: 3.7, y: ty, w: 2.2, h: 0.25,
                    fontSize: 8.8, fontFace: FONT_TITLE, color: C.textMain, bold: true
                });
                s6.addText(t.rate, {
                    x: 5.9, y: ty, w: 1.6, h: 0.25,
                    fontSize: 8.8, fontFace: FONT_BODY, color: C.amber, bold: true
                });
                s6.addText(t.formula, {
                    x: 7.5, y: ty, w: 1.8, h: 0.25,
                    fontSize: 8.2, fontFace: FONT_BODY, color: C.textSub
                });
            });

            // 우측 하단: 화면의 4대 핵심 표시 안내
            s6.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 3.5, y: 3.25, w: 5.9, h: 1.75,
                fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                rectRadius: 0.1
            });
            s6.addText('⚡ 실전 화면 결과 보는 법 (100% 자동 산출)', {
                x: 3.7, y: 3.35, w: 5.5, h: 0.28,
                fontSize: 11, fontFace: FONT_TITLE, color: C.emerald, bold: true
            });

            const resultPoints = [
                { name: '최종 지원금 (법인카드)', desc: '규정 한도 내에서 회사가 지급할 법인카드 총액 (실화면: 360,000원)' },
                { name: '🔥 인당 자부담 비용', desc: '참석자 1인당 계좌 입금 또는 현장 결제할 1인 금액 (실화면: 10,000원)' },
                { name: '클럽 잔여 예산 실시간 차감', desc: '이전 잔여 예산(423,200원) ➔ 이번 지원 후 잔여(63,200원) 즉시 확인' },
                { name: '💾 [정산 완료] 원클릭 마감', desc: '버튼 클릭 시 Firebase 공유 DB에 저장 + 전사원 카운트 동기화 완료' }
            ];

            resultPoints.forEach((r, idx) => {
                const ry = 3.65 + idx * 0.31;
                s6.addText(`✓ ${r.name}:`, {
                    x: 3.7, y: ry, w: 2.1, h: 0.26,
                    fontSize: 8.8, fontFace: FONT_TITLE, color: C.primaryLight, bold: true
                });
                s6.addText(r.desc, {
                    x: 5.8, y: ry, w: 3.5, h: 0.26,
                    fontSize: 8.5, fontFace: FONT_BODY, color: C.textMain
                });
            });
        }

        // =========================================================================
        // SLIDE 7: Step 5. 정산 이력 및 엑셀 재다운로드 (08_history_tab)
        // =========================================================================
        {
            const s7 = createBaseSlide(
                'Step 5. 정산 이력 관리 & 공식 엑셀 품의서 원클릭 다운로드',
                '완료된 정산 내역이 투명하게 보관되며, 회사 공식 품의 엑셀을 언제든 재다운로드할 수 있습니다.'
            );

            // 좌측: 실제 스크린샷 (정산 이력 탭 실화면)
            if (imgs.history) {
                s7.addImage({
                    data: 'image/png;base64,' + imgs.history,
                    x: 0.6, y: 1.45, w: 5.2, h: 3.55
                });
            }

            // 우측: 상세 가이드
            s7.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 6.0, y: 1.45, w: 3.4, h: 3.55,
                fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                rectRadius: 0.12
            });

            s7.addText('📑 정산 이력 & 엑셀 다운로드', {
                x: 6.2, y: 1.6, w: 3.0, h: 0.35,
                fontSize: 13, fontFace: FONT_TITLE, color: C.emerald, bold: true
            });

            const guides7 = [
                { no: '①', title: '클럽 예산 실시간 요약 대시보드', text: '총 예산(154만원), 잔여 예산(42.3만원), 총 참석 인원(53명), 상품비 누적액이 상단 배너에 즉시 집계됩니다.' },
                { no: '②', title: '행사 날짜별 상세 내역 조회', text: '행사일, 참석 인원, 행사비, 시설비, 상품비, 회사 지원금, 자부담 비용이 한눈에 표 형태로 정리됩니다.' },
                { no: '③', title: '공식 엑셀 품의서 즉시 다운로드', text: "우측 초록색 [엑셀] 버튼을 누르면 회사 공식 템플릿(template.xlsx)에 모든 셀 좌표가 완벽 매핑된 .xlsx 파일이 생성됩니다." },
                { no: '④', title: '투명한 이력 공유 및 보관', text: '일반 회원은 본인 작성 내역을 확인하고, 관리자는 전사 클럽 집행 현황을 검토할 수 있습니다.' }
            ];

            guides7.forEach((g, idx) => {
                const gy = 2.05 + idx * 0.64;
                s7.addText(`${g.no} ${g.title}`, {
                    x: 6.2, y: gy, w: 3.0, h: 0.24,
                    fontSize: 10, fontFace: FONT_TITLE, color: C.textMain, bold: true
                });
                s7.addText(g.text, {
                    x: 6.45, y: gy + 0.22, w: 2.75, h: 0.38,
                    fontSize: 8.5, fontFace: FONT_BODY, color: C.textSub, lineSpacing: 12
                });
            });

            // 엑셀 서식 안내
            s7.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 6.2, y: 4.5, w: 3.0, h: 0.42,
                fill: { color: '064E3B' }, line: { color: C.emerald, width: 0.8 },
                rectRadius: 0.06
            });
            s7.addText('✓ 엑셀 다운로드 시 K4~K30, L12~L25 등 회사 ERP/회계 제출용 좌표가 100% 자동 매핑됩니다.', {
                x: 6.3, y: 4.53, w: 2.8, h: 0.36,
                fontSize: 8.0, fontFace: FONT_BODY, color: '#A7F3D0', lineSpacing: 11
            });
        }

        // =========================================================================
        // SLIDE 8: [관리자] 대시보드 관리 (09_admin_dashboard)
        // =========================================================================
        {
            const s8 = createBaseSlide(
                '[관리자] 전체 관리자 모드: 대시보드 & KPI 모니터링',
                '클럽 회장단 및 관리자(PIN: 000000)를 위한 전사 운영 현황 통합 관리 화면입니다.',
                '관리자 전용 기능 (회장단)'
            );

            // 좌측: 실제 스크린샷 (09_admin_dashboard)
            if (imgs.adminDash) {
                s8.addImage({
                    data: 'image/png;base64,' + imgs.adminDash,
                    x: 0.6, y: 1.45, w: 5.1, h: 3.55
                });
            }

            // 우측: 관리자 핵심 기능
            s8.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 5.9, y: 1.45, w: 3.5, h: 3.55,
                fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                rectRadius: 0.12
            });

            s8.addText('👑 관리자 전용 대시보드 핵심', {
                x: 6.1, y: 1.6, w: 3.1, h: 0.35,
                fontSize: 13, fontFace: FONT_TITLE, color: C.amber, bold: true
            });

            const guides8 = [
                { no: '①', title: '전사 총괄 4대 KPI 실시간 타일', text: '총 등록 가입자(7명), 전체 누적 지출액(1,159만원), 회사 지원금(948만원), 임직원 자부담(211만원) 실시간 집계' },
                { no: '②', title: '초보 관리자 3단계 온보딩 가이드', text: '① 클럽·예산 설정 ➔ ② 정산 기준 확인 ➔ ③ 정산 현황 확인으로 이어지는 간편 네비게이션 제공' },
                { no: '③', title: '정산 구간 및 비율 전사 설정', text: '지원 규정 변경 시 가/나/다/라 구간 한도액(3만/6만/12만)과 자부담 비율(20%/40%)을 관리자가 직접 유연하게 조정' },
                { no: '④', title: '연간 결산 PPT & 감사 로그', text: '경영진 보고용 파워포인트 자동 생성 및 데이터 위변조 방지를 위한 전사 작업 로그 기록' }
            ];

            guides8.forEach((g, idx) => {
                const gy = 2.05 + idx * 0.64;
                s8.addText(`${g.no} ${g.title}`, {
                    x: 6.1, y: gy, w: 3.1, h: 0.24,
                    fontSize: 9.8, fontFace: FONT_TITLE, color: C.textMain, bold: true
                });
                s8.addText(g.text, {
                    x: 6.35, y: gy + 0.22, w: 2.85, h: 0.38,
                    fontSize: 8.5, fontFace: FONT_BODY, color: C.textSub, lineSpacing: 12
                });
            });

            // 관리자 팁
            s8.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 6.1, y: 4.5, w: 3.1, h: 0.42,
                fill: { color: '451A03' }, line: { color: C.amber, width: 0.8 },
                rectRadius: 0.06
            });
            s8.addText('⚠️ 관리자 설정값은 모든 클럽 사용자에게 즉시 적용되며 Firebase 단일 기준으로 안전하게 동기화됩니다.', {
                x: 6.2, y: 4.53, w: 2.9, h: 0.36,
                fontSize: 8.0, fontFace: FONT_BODY, color: '#FDE68A', lineSpacing: 11
            });
        }

        // =========================================================================
        // SLIDE 9: [관리자] 클럽별 정산 이력 (10_club_history_tab)
        // =========================================================================
        {
            const s9 = createBaseSlide(
                '[관리자] 전사 클럽별 정산 이력 & 정산인별 필터링',
                '전사 10개 클럽의 행사 집행 내역을 한곳에서 모니터링하고 작성자별로 교차 검토합니다.',
                '관리자 전용 기능 (회장단)'
            );

            // 좌측: 실제 스크린샷 (10_club_history_tab)
            if (imgs.clubHistory) {
                s9.addImage({
                    data: 'image/png;base64,' + imgs.clubHistory,
                    x: 0.6, y: 1.45, w: 5.2, h: 3.55
                });
            }

            // 우측: 상세 가이드
            s9.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 6.0, y: 1.45, w: 3.4, h: 3.55,
                fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                rectRadius: 0.12
            });

            s9.addText('🔍 클럽별 이력 관리 핵심', {
                x: 6.2, y: 1.6, w: 3.0, h: 0.35,
                fontSize: 13, fontFace: FONT_TITLE, color: C.primary, bold: true
            });

            const guides9 = [
                { no: '①', title: '10개 클럽 집행 내역 통합 조회', text: '넷짱, 당구, 멀리건, 볼링, All balls 등 전사 클럽을 선택하여 예산 소진과 행사 이력을 조회합니다.' },
                { no: '②', title: '정산인(작성자) 필터링 (스마트)', text: '해당 클럽에 정산인이 2명 이상일 때만 자동으로 드롭다운이 노출되어 특정 담당자의 정산건만 필터링 가능합니다.' },
                { no: '③', title: '행사 날짜 수정 및 명단 재확인', text: '행사 날짜를 클릭하면 수정할 수 있고, 참석 인원 배지(4명)를 누르면 당시 명단을 즉시 복사/확인합니다.' },
                { no: '④', title: '무결성 보장 삭제 기능 (관리자 전용)', text: '오등록된 정산 삭제 시 globalHistory + 개인 이력 + 참석자 누적 카운트가 완벽히 동시 롤백됩니다.' }
            ];

            guides9.forEach((g, idx) => {
                const gy = 2.05 + idx * 0.64;
                s9.addText(`${g.no} ${g.title}`, {
                    x: 6.2, y: gy, w: 3.0, h: 0.24,
                    fontSize: 10, fontFace: FONT_TITLE, color: C.textMain, bold: true
                });
                s9.addText(g.text, {
                    x: 6.45, y: gy + 0.22, w: 2.75, h: 0.38,
                    fontSize: 8.5, fontFace: FONT_BODY, color: C.textSub, lineSpacing: 12
                });
            });

            s9.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 6.2, y: 4.5, w: 3.0, h: 0.42,
                fill: { color: '2E1065' }, line: { color: C.primary, width: 0.8 },
                rectRadius: 0.06
            });
            s9.addText('✓ 모든 이력 데이터는 Firebase 공유 DB에 실시간 암호화 동기화되어 분실 위험이 없습니다.', {
                x: 6.3, y: 4.53, w: 2.8, h: 0.36,
                fontSize: 8.0, fontFace: FONT_BODY, color: C.primaryLight, lineSpacing: 11
            });
        }

        // =========================================================================
        // SLIDE 10: [관리자] 7대 실시간 시각화 차트 대시보드 (11_charts_tab)
        // =========================================================================
        {
            const s10 = createBaseSlide(
                '[관리자] 7대 실시간 시각화 분석 차트 대시보드',
                '월별 지출액, 예산 소진율, 활동 회원 수 등 7대 핵심 지표를 인터랙티브 차트로 한눈에 파악합니다.',
                '관리자 전용 기능 (회장단)'
            );

            // 좌측: 실제 스크린샷 (11_charts_tab)
            if (imgs.charts) {
                s10.addImage({
                    data: 'image/png;base64,' + imgs.charts,
                    x: 0.6, y: 1.45, w: 5.2, h: 3.55
                });
            }

            // 우측: 7대 분석 차트 안내
            s10.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 6.0, y: 1.45, w: 3.4, h: 3.55,
                fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                rectRadius: 0.12
            });

            s10.addText('📊 7대 실시간 분석 차트', {
                x: 6.2, y: 1.6, w: 3.0, h: 0.35,
                fontSize: 13, fontFace: FONT_TITLE, color: C.blue, bold: true
            });

            const chartsList = [
                { name: '① 월별 지출 현황 (1~12월)', desc: '클럽별 월간 지출액 추이를 멀티 컬러 바 차트로 비교 분석' },
                { name: '② 클럽별 예산 소진율 (80% 주의/100% 초과)', desc: '클럽 고유 색상 매핑 및 소진 위험도에 따른 스마트 경고 표시' },
                { name: '③ 3대 카테고리별 비용 비중', desc: '행사비, 시설·장비, 상품비 구성비를 도넛 차트로 실시간 분석' },
                { name: '④ 클럽별 고유 참석자 분석 (중복 제거)', desc: '사번 기준 중복을 완벽 제거하여 실제 순수 활동 인원수 집계' },
                { name: '⑤ 클럽별 정산 횟수 & 자부담 추이', desc: '동아리별 정기 모임 활성화 수준과 임직원 자부담 변동성 모니터링' }
            ];

            chartsList.forEach((ch, idx) => {
                const cy = 2.05 + idx * 0.52;
                s10.addText(ch.name, {
                    x: 6.2, y: cy, w: 3.0, h: 0.22,
                    fontSize: 9.5, fontFace: FONT_TITLE, color: C.textMain, bold: true
                });
                s10.addText(ch.desc, {
                    x: 6.4, y: cy + 0.2, w: 2.8, h: 0.3,
                    fontSize: 8.2, fontFace: FONT_BODY, color: C.textSub, lineSpacing: 11
                });
            });

            s10.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 6.2, y: 4.5, w: 3.0, h: 0.42,
                fill: { color: '1E3A8A' }, line: { color: C.blue, width: 0.8 },
                rectRadius: 0.06
            });
            s10.addText('✓ 클럽 필터 칩으로 특정 클럽만 선택하여 비교하거나 [전체 선택]으로 전사 총괄 비교가 가능합니다.', {
                x: 6.3, y: 4.53, w: 2.8, h: 0.36,
                fontSize: 7.8, fontFace: FONT_BODY, color: '#93C5FD', lineSpacing: 11
            });
        }

        // =========================================================================
        // SLIDE 11: [관리자] 1클릭 연간 결산 PPT 보고서 자동 생성 (12_ppt_modal)
        // =========================================================================
        {
            const s11 = createBaseSlide(
                '[관리자] 1클릭 연간 클럽 결산 PPT 보고서 자동 생성',
                '수작업으로 며칠씩 걸리던 경영진 연말 결산 보고서가 클릭 한 번에 16:9 와이드 PPTX로 자동 빌드됩니다.',
                '관리자 전용 기능 (회장단)'
            );

            // 좌측: 실제 스크린샷 (12_ppt_modal)
            if (imgs.pptModal) {
                s11.addImage({
                    data: 'image/png;base64,' + imgs.pptModal,
                    x: 0.6, y: 1.45, w: 2.8, h: 3.55
                });
            }

            // 우측: PPT 자동 생성 기능 명세
            s11.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 3.6, y: 1.45, w: 5.8, h: 3.55,
                fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                rectRadius: 0.12
            });

            s11.addText('🚀 연간 결산 PPT 자동화 3대 핵심 강점', {
                x: 3.8, y: 1.6, w: 5.4, h: 0.35,
                fontSize: 13, fontFace: FONT_TITLE, color: C.amber, bold: true
            });

            const pptSpecs = [
                {
                    title: '① 경영진 보고용 16:9 와이드 디자인 자동 적용',
                    desc: '표지, 전사 총괄 KPI 요약, 재원·용도 2대 도넛 차트, 클럽별 소진율 바 차트, 10개 클럽 종합 비교표, 월별 활동 타임라인까지 풀 패키지 슬라이드 자동 생성'
                },
                {
                    title: '② 데이터 100% 실시간 동기화 및 오차 제로',
                    desc: '총 집행액(1,159만원), 연간 예산(1,570만원), 회사 지원금(81.8%), 임직원 자부담(18.2%), 상품비(75.7만원) 등 당일 최신 확정 데이터가 오차 없이 즉시 차트화'
                },
                {
                    title: '③ 즉시 편집 가능한 네이티브 PPTX 파일 다운로드',
                    desc: '단순 캡처 이미지가 아니라 파워포인트 도형, 표, 차트 객체로 생성되므로 다운로드 후 발표자가 폰트, 색상, 코멘트를 자유롭게 추가 편집 가능'
                }
            ];

            pptSpecs.forEach((p, idx) => {
                const py = 2.05 + idx * 0.76;
                s11.addText(p.title, {
                    x: 3.8, y: py, w: 5.4, h: 0.25,
                    fontSize: 10.5, fontFace: FONT_TITLE, color: C.textMain, bold: true
                });
                s11.addText(p.desc, {
                    x: 4.05, y: py + 0.24, w: 5.15, h: 0.44,
                    fontSize: 9.0, fontFace: FONT_BODY, color: C.textSub, lineSpacing: 13
                });
            });

            // 다운로드 버튼 안내
            s11.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 3.8, y: 4.4, w: 5.4, h: 0.48,
                fill: { color: '7C2D12' }, line: { color: C.amber, width: 1 },
                rectRadius: 0.08
            });
            s11.addText('📥 [PPTX 다운로드] 주황색 버튼 클릭 ➔ 3초 만에 파일 다운로드 완료! 연말 감사 및 예산 심의 보고 완벽 대응!', {
                x: 3.9, y: 4.43, w: 5.2, h: 0.42,
                fontSize: 9.0, fontFace: FONT_TITLE, color: '#FDE68A', bold: true, align: 'center', valign: 'middle'
            });
        }

        // =========================================================================
        // SLIDE 12: FAQ & 엔딩 (Ending Slide)
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
                x: 0.6, y: 0.45, w: 8.8, h: 0.4,
                fontSize: 18, fontFace: FONT_TITLE, color: C.textMain, bold: true
            });
            s12.addText('정산 시스템 사용 중 궁금한 점과 특수 상황 처리 방법입니다.', {
                x: 0.6, y: 0.88, w: 8.8, h: 0.26,
                fontSize: 10, fontFace: FONT_BODY, color: C.textSub
            });

            const faqs = [
                {
                    q: 'Q1. 인당 지원 한도(85,000원)를 초과하는 특별 행사는 어떻게 하나요?',
                    a: 'A: 임원진 사전 승인을 득한 특별 행사는 관리자(회장단)가 클럽 관리 메뉴에서 해당 클럽의 [1회성 초과 지원 승인] 토글을 활성화하여 잔여 예산 내에서 최대치로 정산할 수 있습니다 (정산 확정 시 1회 사용 후 자동 리셋).'
                },
                {
                    q: 'Q2. 실제 영수증 상황에 맞춰 자부담 금액을 수동 수정할 수 있나요?',
                    a: 'A: 네! 결과 카드의 [총 자부담 금액 (수정 가능)] 입력창에서 원하는 금액을 직접 입력하시면 수동 입력값이 최우선 반영되어 최종 지원금이 자동 재조정됩니다.'
                },
                {
                    q: 'Q3. 모바일 스마트폰에서도 컴퓨터와 똑같이 사용할 수 있나요?',
                    a: 'A: 100% 동일합니다. 반응형 모바일 PWA로 개발되어 스마트폰 화면에서도 터치 키패드, 명부 검색, 영수증 사진 업로드, 엑셀 다운로드가 원활하게 동작합니다.'
                },
                {
                    q: 'Q4. 새해가 되면 전사원 명부의 참석 횟수는 삭제되나요?',
                    a: 'A: 삭제되지 않습니다! 매년 1월 1일 첫 로그인 시 직전 연도 카운트는 연도별 히스토리로 안전하게 영구 아카이빙된 후 새해 카운트만 0회로 자동 리셋됩니다.'
                }
            ];

            faqs.forEach((f, idx) => {
                const fx = 0.6 + (idx % 2) * 4.5;
                const fy = 1.25 + Math.floor(idx / 2) * 1.55;
                s12.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                    x: fx, y: fy, w: 4.3, h: 1.45,
                    fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                    rectRadius: 0.1
                });
                s12.addText(f.q, {
                    x: fx + 0.15, y: fy + 0.12, w: 4.0, h: 0.32,
                    fontSize: 9.8, fontFace: FONT_TITLE, color: C.amber, bold: true
                });
                s12.addText(f.a, {
                    x: fx + 0.15, y: fy + 0.44, w: 4.0, h: 0.9,
                    fontSize: 8.5, fontFace: FONT_BODY, color: C.textMain, lineSpacing: 12
                });
            });

            // 하단 땡큐 배너
            s12.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 0.6, y: 4.45, w: 8.8, h: 0.75,
                fill: { color: '2E1065' }, line: { color: C.primary, width: 1.2 },
                rectRadius: 0.1
            });
            s12.addText('👏 경청해 주셔서 감사합니다! 즐겁고 투명한 사내 동아리 활동을 응원합니다.', {
                x: 0.8, y: 4.55, w: 6.0, h: 0.3,
                fontSize: 11.5, fontFace: FONT_TITLE, color: C.textMain, bold: true
            });
            s12.addText('시스템 문의 및 신규 동아리 등록 신청: 김종필 (사내 메신저 / 시스템 개발 담당)', {
                x: 0.8, y: 4.88, w: 6.0, h: 0.24,
                fontSize: 9.0, fontFace: FONT_BODY, color: C.primaryLight
            });
            s12.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 7.2, y: 4.58, w: 2.0, h: 0.48,
                fill: { color: C.primary }, line: { color: C.primaryLight, width: 1 },
                rectRadius: 0.08
            });
            s12.addText('⚡ 지금 바로 시작하기', {
                x: 7.2, y: 4.58, w: 2.0, h: 0.48,
                fontSize: 10, fontFace: FONT_TITLE, color: C.white, bold: true, align: 'center', valign: 'middle'
            });
        }

        // 빌드 및 base64 반환
        return await pptx.write('base64');
    }, images);

    await browser.close();

    const outPath = path.join(__dirname, '3M_사내_클럽_비용_정산_시스템_사용_설명회.pptx');
    fs.writeFileSync(outPath, Buffer.from(pptxBase64, 'base64'));
    const stats = fs.statSync(outPath);
    console.log(`SUCCESS! Created Visual PPTX at: ${outPath} (${(stats.size / 1024).toFixed(1)} KB)`);
})();
