const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
    console.log('--- Building PC Admin Manual PPTX ---');
    const outDir = path.join(__dirname, 'ppt_screenshots');

    const getImgBase64 = (filename) => {
        const p = path.join(outDir, filename);
        if (fs.existsSync(p)) return fs.readFileSync(p).toString('base64');
        console.warn(`File not found: ${filename}`);
        return null;
    };

    const images = {
        archDiagram: getImgBase64('00_system_architecture_flow.jpg'),
        adminDash: getImgBase64('09_admin_dashboard_wide.png') || getImgBase64('09_admin_dashboard.png'),
        clubHistory: getImgBase64('10_club_history_tab.png'),
        charts: getImgBase64('11_charts_tab.png'),
        pptModal: getImgBase64('12_ppt_modal.png'),
        auditLog: getImgBase64('13_audit_log_modal.png')
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

        function createAdminSlide(title, subtitle, badgeText = 'PC 관리자 운영 매뉴얼') {
            const slide = pptx.addSlide();
            slide.addShape(pptx.shapes.RECTANGLE, {
                x: 0, y: 0, w: 10, h: 5.625,
                fill: { color: C.bg }, line: { color: C.bg }
            });
            slide.addShape(pptx.shapes.RECTANGLE, {
                x: 0, y: 0, w: 10, h: 0.08,
                fill: { color: C.amber }, line: { color: C.amber }
            });

            // 상단 배지
            slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 0.6, y: 0.28, w: 2.7, h: 0.32,
                fill: { color: C.amberLight }, line: { color: '#FDE68A', width: 1 },
                rectRadius: 0.08
            });
            slide.addText(`👑 ${badgeText}`, {
                x: 0.6, y: 0.28, w: 2.7, h: 0.32,
                fontSize: 9, fontFace: FONT_TITLE, color: '#92400E', bold: true, align: 'center', valign: 'middle',
                margin: 0
            });

            slide.addText(title, {
                x: 3.5, y: 0.24, w: 5.9, h: 0.38,
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
            s1.addShape(pptx.shapes.RECTANGLE, {
                x: 0, y: 0, w: 10, h: 0.12,
                fill: { color: C.amber }, line: { color: C.amber }
            });

            s1.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 0.8, y: 0.85, w: 3.5, h: 0.40,
                fill: { color: C.amberLight }, line: { color: '#FDE68A', width: 1.2 },
                rectRadius: 0.08
            });
            s1.addText('👑 3M 사내 클럽 비용 정산기 (v1.7.0)', {
                x: 0.8, y: 0.85, w: 3.5, h: 0.40,
                fontSize: 10.5, fontFace: FONT_TITLE, color: '#92400E', bold: true, align: 'center', valign: 'middle'
            });

            s1.addText('시스템 관리자 운영 매뉴얼 (PC 버전)', {
                x: 0.8, y: 1.45, w: 8.4, h: 0.85,
                fontSize: 31, fontFace: FONT_TITLE, color: C.textMain, bold: true
            });

            s1.addText('동아리 연합 회장단 & 시스템 총괄 관리자(PIN: 000000)를 위한 전사 운영·감사 가이드', {
                x: 0.8, y: 2.38, w: 8.4, h: 0.38,
                fontSize: 12.5, fontFace: FONT_BODY, color: C.textSub
            });

            const adminCards = [
                { icon: '🖥️', title: '2열 와이드 대시보드', desc: '1440/1920 PC 화면에 최적화된 좌우 2열 분할 및 4대 KPI 집계', color: C.primary },
                { icon: '🔍', title: '2x2 전사 정산 이력', desc: '10개 클럽 집행 내역 4분할 동시 비교 및 정산인 스마트 필터', color: C.emerald },
                { icon: '📊', title: '7대 시각화 & 결산 PPT', desc: '소진율 위험 경고 차트 및 클릭 1번에 16:9 경영진 보고서 생성', color: C.amber }
            ];

            adminCards.forEach((c, idx) => {
                const cx = 0.8 + idx * 2.85;
                s1.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                    x: cx, y: 3.05, w: 2.65, h: 1.45,
                    fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                    rectRadius: 0.1
                });
                s1.addText(c.icon, {
                    x: cx + 0.2, y: 3.18, w: 0.5, h: 0.38,
                    fontSize: 18, align: 'left'
                });
                s1.addText(c.title, {
                    x: cx + 0.2, y: 3.58, w: 2.25, h: 0.28,
                    fontSize: 11, fontFace: FONT_TITLE, color: c.color, bold: true
                });
                s1.addText(c.desc, {
                    x: cx + 0.2, y: 3.90, w: 2.25, h: 0.48,
                    fontSize: 8.8, fontFace: FONT_BODY, color: C.textSub, lineSpacing: 13
                });
            });

            // 하단 메타정보
            s1.addText('배포일: 2026. 11. 11  |  시스템 총괄 관리자 전용 (PC)  |  시스템 버전: v1.7.0 (최신 정식 배포판)', {
                x: 0.8, y: 4.88, w: 8.4, h: 0.35,
                fontSize: 9.2, fontFace: FONT_BODY, color: C.textMuted
            });
        }

        // ==========================================
        // SLIDE 2: 시스템 아키텍처 & 클라우드 데이터 흐름
        // ==========================================
        {
            const s2 = createAdminSlide(
                '시스템 아키텍처 & 클라우드 데이터 흐름',
                'Firebase 실시간 NoSQL 클라우드 DB를 단일 기준으로 하여 데이터의 정합성과 실시간 동기화를 보장합니다.'
            );

            if (imgs.archDiagram) {
                s2.addImage({
                    data: 'image/jpeg;base64,' + imgs.archDiagram,
                    x: 0.6, y: 1.25, w: 4.6, h: 3.95
                });
            }

            s2.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 5.4, y: 1.25, w: 4.0, h: 3.95,
                fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                rectRadius: 0.12
            });

            s2.addText('☁️ 클라우드 인프라 & 데이터 원칙', {
                x: 5.65, y: 1.45, w: 3.5, h: 0.35,
                fontSize: 12.5, fontFace: FONT_TITLE, color: C.primary, bold: true
            });

            const archGuides = [
                {
                    title: '① 관리자(PIN: 000000) 단일 기준 원칙',
                    desc: '총 예산, 클럽 목록, 누적 지출액, 정산 구간·비율 등 모든 기준 데이터는 관리자가 설정한 Firebase 단일 경로에서만 읽고 씁니다.'
                },
                {
                    title: '② 실시간(Realtime) 양방향 동기화',
                    desc: '전사원 명부, 비용 항목, 클럽 설정이 변경되는 즉시 WebSocket을 통해 모든 접속자 화면에 새로고침 없이 1초 내 자동 반영됩니다.'
                },
                {
                    title: '③ 100% 서버리스 & 영구 보관',
                    desc: '별도의 로컬 서버 구축 없이 Google Cloud 인프라에서 가동되어 다운타임이 없으며 과거 데이터가 안전하게 보관됩니다.'
                }
            ];

            archGuides.forEach((a, idx) => {
                const ay = 1.9 + idx * 0.95;
                s2.addText([
                    { text: `${a.title}\n`, options: { bold: true, fontSize: 10, color: C.textMain } },
                    { text: a.desc, options: { fontSize: 8.3, color: C.textSub } }
                ], {
                    x: 5.65, y: ay, w: 3.5, h: 0.88,
                    lineSpacing: 12.5, valign: 'top'
                });
            });
        }

        // ==========================================
        // SLIDE 3: 2열 와이드 대시보드 & 4대 KPI
        // ==========================================
        {
            const s3 = createAdminSlide(
                'PC 2열 와이드 대시보드 & 4대 KPI 총괄 관리',
                '대화면 PC 모니터에 최적화된 2열 독립 분할 레이아웃으로 전사 4대 지표와 클럽 현황을 한눈에 조망합니다.'
            );

            if (imgs.adminDash) {
                s3.addImage({
                    data: 'image/png;base64,' + imgs.adminDash,
                    x: 0.6, y: 1.25, w: 5.4, h: 3.95
                });
            }

            s3.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 6.2, y: 1.25, w: 3.2, h: 3.95,
                fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                rectRadius: 0.12
            });

            s3.addText('📊 2열 대시보드 핵심 구조', {
                x: 6.4, y: 1.45, w: 2.8, h: 0.35,
                fontSize: 12, fontFace: FONT_TITLE, color: C.amber, bold: true
            });

            const dashGuides = [
                { title: '① 상단 4대 핵심 KPI 타일', text: '전사 등록 회원 수, 총 지출액, 회사 지원금, 임직원 자부담 실시간 누적 집계' },
                { title: '② 좌측 컬럼 (설정 & 기준)', text: '정산 구간 및 4단계 비율 설정 카드가 상단에 밀착되어 빠른 설정 변경 지원' },
                { title: '③ 우측 컬럼 (마스터 관리)', text: '10개 클럽 예산 배정 현황과 가입 회원 관리 목록이 스크롤 없이 시원하게 표시' },
                { title: '④ 카드 원터치 접기/펼치기', text: '필요 없는 카드를 접으면 하단 카드가 자동으로 위로 밀착되어 공간 효율 극대화' }
            ];

            dashGuides.forEach((d, idx) => {
                const dy = 1.9 + idx * 0.72;
                s3.addText([
                    { text: `${d.title}\n`, options: { bold: true, fontSize: 9.5, color: C.textMain } },
                    { text: d.text, options: { fontSize: 8.0, color: C.textSub } }
                ], {
                    x: 6.4, y: dy, w: 2.8, h: 0.65,
                    lineSpacing: 11.5, valign: 'top'
                });
            });
        }

        // ==========================================
        // SLIDE 4: 클럽 관리 & 1회성 초과 승인 토글
        // ==========================================
        {
            const s4 = createAdminSlide(
                '클럽 예산 관리 & 85,000원 1회성 초과 지원 승인',
                '클럽별 연간 배정 예산을 설정하고, 특별 행사 시 인당 85,000원 초과 지원을 사전 승인 및 자동 리셋합니다.'
            );

            // 좌측 설명 카드
            s4.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 0.6, y: 1.25, w: 4.3, h: 3.95,
                fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                rectRadius: 0.12
            });

            s4.addText('🏢 클럽 예산 및 권한 통제', {
                x: 0.85, y: 1.45, w: 3.8, h: 0.35,
                fontSize: 12.5, fontFace: FONT_TITLE, color: C.primary, bold: true
            });

            const clubPoints = [
                {
                    title: '① 클럽별 연간 예산 배정 (총 1,000만원 규모)',
                    desc: '10개 클럽별로 연간 확정 예산을 입력하면, 정산 완료 시마다 실시간으로 잔여 예산이 차감 계산됩니다.'
                },
                {
                    title: '② 상품비 연간 50만원 한도 자동 잠금',
                    desc: '클럽당 연 50만원 상품비 한도를 시스템이 실시간 누적 관리하여 초과 등록 시 즉각 차단합니다.'
                },
                {
                    title: '③ 신규 클럽 등록 및 비활성화',
                    desc: '신설 동아리 추가 시 즉시 전 사용자에게 노출되며, 활동 중단 클럽은 안전하게 보관 처리됩니다.'
                }
            ];

            clubPoints.forEach((p, idx) => {
                const py = 1.9 + idx * 0.95;
                s4.addText([
                    { text: `${p.title}\n`, options: { bold: true, fontSize: 10, color: C.textMain } },
                    { text: p.desc, options: { fontSize: 8.3, color: C.textSub } }
                ], {
                    x: 0.85, y: py, w: 3.8, h: 0.88,
                    lineSpacing: 12.5, valign: 'top'
                });
            });

            // 우측 특별 승인 토글 카드
            s4.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 5.1, y: 1.25, w: 4.3, h: 3.95,
                fill: { color: C.cardBg }, line: { color: '#FCD34D', width: 1.5 },
                rectRadius: 0.12
            });

            s4.addText('⚠️ [핵심] 85,000원 1회성 초과 승인 메커니즘', {
                x: 5.35, y: 1.45, w: 3.8, h: 0.35,
                fontSize: 12.5, fontFace: FONT_TITLE, color: C.amber, bold: true
            });

            const toggleGuides = [
                {
                    title: '• 특별 행사 시 인당 85,000원 초과 지원 허용',
                    desc: '대규모 워크숍이나 특별 이벤트로 인해 인당 행사비가 지원 한도(85,000원)를 넘는 경우, 관리자가 클럽 목록에서 [초과 지원 승인] 토글을 켭니다.'
                },
                {
                    title: '• 정산 확정 시 무조건 자동 OFF (1회성 안전장치)',
                    desc: '사용자가 해당 승인을 이용해 정산을 완료하면, 시스템이 승인 토글을 자동으로 즉시 OFF로 리셋합니다. (영구 활성화로 인한 예산 남용 원천 방지)'
                },
                {
                    title: '• 클럽 잔여 예산 범위 내 하드캡 적용',
                    desc: '초과 지원이 승인되더라도 해당 클럽의 남은 연간 예산 자체를 초과하여 지원될 수는 없습니다.'
                }
            ];

            toggleGuides.forEach((t, idx) => {
                const ty = 1.9 + idx * 0.95;
                s4.addText([
                    { text: `${t.title}\n`, options: { bold: true, fontSize: 10, color: C.textMain } },
                    { text: t.desc, options: { fontSize: 8.3, color: C.textSub } }
                ], {
                    x: 5.35, y: ty, w: 3.8, h: 0.88,
                    lineSpacing: 12.5, valign: 'top'
                });
            });
        }

        // ==========================================
        // SLIDE 5: 2x2 클럽별 정산 이력 그리드
        // ==========================================
        {
            const s5 = createAdminSlide(
                'PC 전사 클럽별 정산 이력: 2x2 와이드 그리드 & 다중 필터',
                '10개 클럽 집행 내역을 2x2 와이드 4분할 그리드로 한눈에 비교하고, 정산인·클럽별로 교차 검토합니다.'
            );

            if (imgs.clubHistory) {
                s5.addImage({
                    data: 'image/png;base64,' + imgs.clubHistory,
                    x: 0.6, y: 1.25, w: 5.4, h: 3.95
                });
            }

            s5.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 6.2, y: 1.25, w: 3.2, h: 3.95,
                fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                rectRadius: 0.12
            });

            s5.addText('🔍 이력 검토 & 감사 기능', {
                x: 6.4, y: 1.45, w: 2.8, h: 0.35,
                fontSize: 12, fontFace: FONT_TITLE, color: C.primary, bold: true
            });

            const histGuides = [
                { title: '① 2x2 와이드 4분할 그리드', text: '4개 클럽의 행사 내역을 한 화면에 꽉 찬 가로 10개 컬럼 표로 동시에 모니터링' },
                { title: '② 특정 클럽 단독 전폭(100%) 뷰', text: '상단 드롭다운에서 클럽 선택 시 전체 폭으로 상세 내역 집중 조회' },
                { title: '③ 정산인(작성자) 스마트 필터', text: '정산인이 2명 이상인 클럽만 드롭다운이 자동 노출되어 작성자별 교차 검토' },
                { title: '④ 안전한 삭제 & 예산 자동 롤백', text: '관리자 삭제 시 클럽 잔여 예산과 전사원 명부 카운트가 즉시 완벽 롤백' }
            ];

            histGuides.forEach((h, idx) => {
                const hy = 1.9 + idx * 0.72;
                s5.addText([
                    { text: `${h.title}\n`, options: { bold: true, fontSize: 9.5, color: C.textMain } },
                    { text: h.text, options: { fontSize: 8.0, color: C.textSub } }
                ], {
                    x: 6.4, y: hy, w: 2.8, h: 0.65,
                    lineSpacing: 11.5, valign: 'top'
                });
            });
        }

        // ==========================================
        // SLIDE 6: 7대 실시간 시각화 차트 대시보드
        // ==========================================
        {
            const s6 = createAdminSlide(
                'PC 7대 실시간 시각화 분석 차트 대시보드',
                '월별 지출액, 예산 소진율 경고, 순수 참석 인원(중복 제외) 등 7대 핵심 지표를 파노라마 차트로 분석합니다.'
            );

            if (imgs.charts) {
                s6.addImage({
                    data: 'image/png;base64,' + imgs.charts,
                    x: 0.6, y: 1.25, w: 5.4, h: 3.95
                });
            }

            s6.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 6.2, y: 1.25, w: 3.2, h: 3.95,
                fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                rectRadius: 0.12
            });

            s6.addText('📈 7대 분석 차트 핵심 지표', {
                x: 6.4, y: 1.45, w: 2.8, h: 0.35,
                fontSize: 12, fontFace: FONT_TITLE, color: C.primary, bold: true
            });

            const chartGuides = [
                { title: '① 클럽별 예산 소진율 (위험도 경고)', text: '안전(초록), 주의(80% 노랑), 초과(100% 빨강) 글씨색으로 예산 위험 즉시 식별' },
                { title: '② 클럽별 순수 참석자 (중복 제외)', text: '사번 기준 중복을 완벽 제거하여 실제 순수 활동 인원수를 정확하게 집계' },
                { title: '③ 3대 비용 구성 비중 도넛 차트', text: '행사비, 시설·장비, 상품비 구성비를 도넛 차트로 실시간 분석' },
                { title: '④ 월별 지출 현황 (1~12월)', text: '클럽별 월간 지출액 추이를 고유 색상 바 차트로 직관적 비교' }
            ];

            chartGuides.forEach((c, idx) => {
                const cy = 1.9 + idx * 0.72;
                s6.addText([
                    { text: `${c.title}\n`, options: { bold: true, fontSize: 9.5, color: C.textMain } },
                    { text: c.text, options: { fontSize: 8.0, color: C.textSub } }
                ], {
                    x: 6.4, y: cy, w: 2.8, h: 0.65,
                    lineSpacing: 11.5, valign: 'top'
                });
            });
        }

        // ==========================================
        // SLIDE 7: 전체 작업 로그 (감사 추적)
        // ==========================================
        {
            const s7 = createAdminSlide(
                '전체 작업 로그: 데이터 등록·수정·삭제 완벽 감사 추적',
                '단순 액션은 제외하고 정산 확정·수정 및 데이터 변경 이력만 투명하게 기록하여 이상 징후를 감시합니다.'
            );

            if (imgs.auditLog) {
                s7.addImage({
                    data: 'image/png;base64,' + imgs.auditLog,
                    x: 0.6, y: 1.25, w: 5.4, h: 3.95
                });
            }

            s7.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 6.2, y: 1.25, w: 3.2, h: 3.95,
                fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                rectRadius: 0.12
            });

            s7.addText('🛡️ 작업 감사 로그 운영 원칙', {
                x: 6.4, y: 1.45, w: 2.8, h: 0.35,
                fontSize: 12, fontFace: FONT_TITLE, color: C.rose, bold: true
            });

            const logGuides = [
                { title: '① 순수 데이터 변경만 엄격 기록', text: '정산 초기화 등 일회성 클릭은 제외하고 확정·수정·삭제 내역만 기록' },
                { title: '② 변경 전/후 상세값 아코디언', text: '각 로그 항목 클릭 시 연월일·시분초·작업자·변경 전후 상세값이 펼쳐짐' },
                { title: '③ 날짜 및 작업 종류별 다중 필터', text: '특정 월 또는 정산 확정/클럽 관리 등 작업 유형별로 즉시 필터링' },
                { title: '④ 관리자 전용 [🗑️ 로그 비우기]', text: '오래된 감사 로그를 안전하게 일괄 정리할 수 있는 관리자 전용 기능 제공' }
            ];

            logGuides.forEach((l, idx) => {
                const ly = 1.9 + idx * 0.72;
                s7.addText([
                    { text: `${l.title}\n`, options: { bold: true, fontSize: 9.5, color: C.textMain } },
                    { text: l.text, options: { fontSize: 8.0, color: C.textSub } }
                ], {
                    x: 6.4, y: ly, w: 2.8, h: 0.65,
                    lineSpacing: 11.5, valign: 'top'
                });
            });
        }

        // ==========================================
        // SLIDE 8: 1클릭 연간 결산 PPT 보고서 자동 생성
        // ==========================================
        {
            const s8 = createAdminSlide(
                '1클릭 연간 결산 PPT 보고서 자동 생성',
                '수작업으로 며칠씩 걸리던 경영진 연말 결산 보고서가 클릭 한 번에 16:9 와이드 PPTX로 자동 빌드됩니다.'
            );

            if (imgs.pptModal) {
                s8.addImage({
                    data: 'image/png;base64,' + imgs.pptModal,
                    x: 0.6, y: 1.25, w: 4.8, h: 3.95
                });
            }

            s8.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 5.6, y: 1.25, w: 3.8, h: 3.95,
                fill: { color: C.cardBg }, line: { color: C.cardBorder, width: 1 },
                rectRadius: 0.12
            });

            s8.addText('🚀 연간 결산 PPT 자동화 강점', {
                x: 5.85, y: 1.45, w: 3.3, h: 0.35,
                fontSize: 12.5, fontFace: FONT_TITLE, color: C.amber, bold: true
            });

            const pptGuides = [
                {
                    title: '① 연도별 데이터 원클릭 선택 & 집계',
                    desc: '원하는 결산 연도(예: 2026년)를 선택하면 해당 연도 전체 정산 내역이 1초 만에 자동 집계됩니다.'
                },
                {
                    title: '② 파워포인트 네이티브 객체 생성',
                    desc: '단순 캡처 이미지가 아니라 파워포인트 도형, 표, 텍스트 상자로 생성되므로 다운로드 후 발표자가 자유롭게 내용 수정 가능'
                },
                {
                    title: '③ 알뜰 예산 운용 클럽 랭킹 자동 선정',
                    desc: '배정 예산 내에서 100% 최다 소진하여 불용 예산을 최소화한 우수 클럽을 시스템이 객관적으로 자동 랭킹'
                }
            ];

            pptGuides.forEach((p, idx) => {
                const py = 1.9 + idx * 0.95;
                s8.addText([
                    { text: `${p.title}\n`, options: { bold: true, fontSize: 10, color: C.textMain } },
                    { text: p.desc, options: { fontSize: 8.3, color: C.textSub } }
                ], {
                    x: 5.85, y: py, w: 3.3, h: 0.88,
                    lineSpacing: 12.5, valign: 'top'
                });
            });
        }

        // ==========================================
        // SLIDE 9: 관리자 FAQ & 운영 수칙
        // ==========================================
        {
            const s9 = pptx.addSlide();
            s9.addShape(pptx.shapes.RECTANGLE, {
                x: 0, y: 0, w: 10, h: 5.625,
                fill: { color: C.bg }, line: { color: C.bg }
            });
            s9.addShape(pptx.shapes.RECTANGLE, {
                x: 0, y: 0, w: 10, h: 0.1,
                fill: { color: C.amber }, line: { color: C.amber }
            });

            s9.addText('시스템 관리자 운영 수칙 & 자주 묻는 질문 (FAQ)', {
                x: 0.8, y: 0.45, w: 8.4, h: 0.4,
                fontSize: 18, fontFace: FONT_TITLE, color: C.textMain, bold: true
            });
            s9.addText('안정적인 시스템 운영을 위해 관리자가 반드시 숙지해야 할 핵심 수칙입니다.', {
                x: 0.8, y: 0.88, w: 8.4, h: 0.28,
                fontSize: 10.5, fontFace: FONT_BODY, color: C.textSub
            });

            const adminFaqs = [
                {
                    q: 'Q1. 과거 정산 이력의 금액을 수정하면 예산 반영은 어떻게 되나요?',
                    a: 'A: 기존 지원금과 수정된 새 지원금의 차액(delta)만큼만 클럽 사용액/잔여 예산에 정확하게 가감 보정되므로 데이터 불일치가 발생하지 않습니다.'
                },
                {
                    q: 'Q2. 전사원 명부의 참석 횟수를 관리자가 수동 수정할 수 있나요?',
                    a: 'A: 네! 전사원 명부 카운트 수동 수정 권한은 오직 관리자(PIN: 000000)에게만 부여되어 있으며, 정산 누락이나 정정 시 즉시 수정 가능합니다.'
                },
                {
                    q: 'Q3. 새해가 되면 작년 참석 횟수와 예산은 어떻게 초기화되나요?',
                    a: 'A: 매년 1월 첫 로그인 시 직전 연도 참석 카운트는 연도별 히스토리에 영구 보관된 후 0회로 안전하게 리셋되며, 예산은 새 회계연도 기준값으로 갱신됩니다.'
                },
                {
                    q: 'Q4. 관리자 비밀번호(PIN: 000000) 변경이나 접근 통제는?',
                    a: 'A: 관리자 PIN은 사내 규정상 회장단 전용 마스터 키로 운영되며, 권한 모델(PERMISSIONS.md)에 따라 개발자(002531) 및 일반 회원과 철저히 분리되어 있습니다.'
                }
            ];

            adminFaqs.forEach((f, idx) => {
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

            s9.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 0.8, y: 4.55, w: 8.4, h: 0.65,
                fill: { color: C.amberLight }, line: { color: '#FDE68A', width: 1 },
                rectRadius: 0.08
            });
            s9.addText('👑 투명하고 신뢰받는 3M 사내 동아리 문화, 시스템 관리자가 함께 만듭니다.', {
                x: 1.0, y: 4.62, w: 8.0, h: 0.5,
                fontSize: 10.5, fontFace: FONT_TITLE, color: '#92400E', bold: true, align: 'center', valign: 'middle'
            });
        }

        const out = await pptx.write({ outputType: 'base64' });
        return out;
    }, images);

    await browser.close();

    const pptxBuffer = Buffer.from(pptxBase64, 'base64');
    const outFile = path.join(__dirname, '3M_사내_클럽_비용_정산_시스템_관리자_매뉴얼(PC).pptx');
    fs.writeFileSync(outFile, pptxBuffer);
    console.log(`SUCCESS! Created PC Admin Manual PPTX at: ${outFile} (${(pptxBuffer.length / 1024).toFixed(1)} KB)`);
})();

