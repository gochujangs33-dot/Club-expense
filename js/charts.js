/**
 * 대시보드 차트 렌더링 모듈 (v1.7.48 분리)
 * Chart.js 플러그인, 클럽 색상 매핑(getClubColorMap), 6종 차트 및 KPI/최근 정산 알림을 담당한다.
 */
(function () {
    function ChartBridge() {
        return window.__ChartBridge || {
            getCachedDeletedIds: () => ({}),
            getSelectedOverallClubs: () => null,
            getCachedChartHistoryList: () => [],
            setCachedChartHistoryList: () => {},
            getChartThemeColors: () => ({ primary: '#f8fafc', secondary: '#94a3b8', grid: 'rgba(148,163,184,0.16)', surface: '#0f172a', tooltip: '#0f172a', tooltipText: '#f8fafc' }),
            updateGlobalYearPickerUI: () => {},
            openClubUsageSummaryModal: () => {},
            openAttendanceRosterModal: () => {},
            getHistoryUsageBreakdown: () => ({ totalCost: 0, eventCost: 0, facilityCost: 0, prizeCost: 0, support: 0, selfPay: 0 })
        };
    }

    let clubActivityChartInstance = null;
    let clubUniqueAttendeesChartInstance = null;

    // ── 차트 탭 상단 KPI 카드 업데이트 ────────────────────────────────────
    function updateChartsBudgetStats(historyList, targetYear) {
        const totalBudgetEl = document.getElementById('charts-total-budget');
        const usedBudgetEl = document.getElementById('charts-used-budget');
        const remainingBudgetEl = document.getElementById('charts-remaining-budget');
        const countEl = document.getElementById('charts-total-count');
        const usageRateEl = document.getElementById('charts-usage-rate');
        if (!totalBudgetEl || !usedBudgetEl || !remainingBudgetEl) return;

        const chartYearSelect = document.getElementById('charts-year-select');
        const effectiveYear = targetYear !== undefined ? targetYear : (
            chartYearSelect && chartYearSelect.value !== 'ALL'
                ? (Number(chartYearSelect.value) || new Date().getFullYear())
                : (chartYearSelect && chartYearSelect.value === 'ALL' ? null : new Date().getFullYear())
        );

        const filtered = (historyList || []).filter(e =>
            (effectiveYear === null || getHistoryEntryYear(e) === effectiveYear)
            && (!(ChartBridge().getSelectedOverallClubs()) || (ChartBridge().getSelectedOverallClubs()).has(e.clubName || '기본 클럽'))
        );

        const selectedClubs = Object.values(AppState.clubRegistry || {})
            .filter(c => !(ChartBridge().getSelectedOverallClubs()) || (ChartBridge().getSelectedOverallClubs()).has(c.name));
        const totalBudget = selectedClubs.reduce((sum, c) => sum + (c.budget || 0), 0);
        const isCurrentYear = effectiveYear === null || effectiveYear === new Date().getFullYear();
        const priorUsed = isCurrentYear ? selectedClubs.reduce((sum, c) => sum + (c.priorUsed || 0), 0) : 0;
        const usedBudget = priorUsed + filtered.reduce((sum, e) => sum + (e.finalSupportAmount || 0), 0);
        const remaining = totalBudget - usedBudget;

        // 진행 중인 KPI 카운트업이 있으면 중단하고 아래 확정값을 즉시 표시 (값 덮어쓰기 방지)
        [totalBudgetEl, usedBudgetEl, remainingBudgetEl, countEl].forEach(cancelCountUp);
        totalBudgetEl.dataset.countValue = String(totalBudget);
        usedBudgetEl.dataset.countValue = String(usedBudget);
        remainingBudgetEl.dataset.countValue = String(remaining);
        if (countEl) countEl.dataset.countValue = String(filtered.length);
        totalBudgetEl.textContent = SettlementCalculator.formatCurrency(totalBudget);
        usedBudgetEl.textContent = SettlementCalculator.formatCurrency(usedBudget);
        remainingBudgetEl.textContent = SettlementCalculator.formatCurrency(remaining);
        remainingBudgetEl.style.color = remaining < 0 ? '#f87171' : 'var(--color-secondary)';
        if (countEl) countEl.textContent = `${filtered.length}건`;
        if (usageRateEl) {
            const usageRate = totalBudget > 0 ? Math.round((usedBudget / totalBudget) * 1000) / 10 : 0;
            usageRateEl.textContent = `예산 소진율 ${usageRate}%`;
            usageRateEl.style.color = getUsageRiskColor(usageRate);
            const usageGaugeFillEl = document.getElementById('charts-usage-gauge-fill');
            if (usageGaugeFillEl) {
                const gaugePct = Math.min(100, Math.max(0, usageRate));
                usageGaugeFillEl.style.width = `${gaugePct}%`;
                usageGaugeFillEl.style.background = getUsageRiskColor(usageRate);
            }
        }
    }

    // ── 차트 탭 진입 모션 ────────────────────────────────────────────────
    // 차트 탭 버튼을 누른 직후의 renderAllCharts 1회에만 모션을 적용한다.
    // 필터·테마·Firebase 재동기화에 따른 차트 재생성은 즉시 표시해 중복 애니메이션을 방지한다.
    let chartEntranceAnimationRequested = false;

    function requestChartEntranceAnimation() {
        chartEntranceAnimationRequested = true;
    }

    function prefersReducedChartMotion() {
        return typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function compactChartMotion() {
        return typeof window.matchMedia === 'function'
            && window.matchMedia('(max-width: 768px)').matches;
    }

    function consumeChartEntranceAnimation() {
        const shouldAnimate = chartEntranceAnimationRequested && !prefersReducedChartMotion();
        chartEntranceAnimationRequested = false;
        return shouldAnimate;
    }

    function barChartEntranceOptions(enabled, indexAxis = 'x') {
        if (!enabled) return { animation: false };
        const compact = compactChartMotion();
        const stagger = compact ? 30 : 50;
        const datasetStagger = compact ? 18 : 32;
        const maxDelay = compact ? 240 : 420;
        const duration = compact ? 720 : 960;
        const valueProperty = indexAxis === 'y' ? 'x' : 'y';
        const valueScale = indexAxis === 'y' ? 'x' : 'y';
        const zeroPixel = context => context.chart.scales[valueScale].getPixelForValue(0);
        const delay = context => {
            if (context.type !== 'data') return 0;
            const dataIndex = Number(context.dataIndex) || 0;
            const datasetIndex = Number(context.datasetIndex) || 0;
            return Math.min((dataIndex * stagger) + (datasetIndex * datasetStagger), maxDelay);
        };
        return {
            animation: {
                duration,
                easing: 'easeOutQuart',
                delay
            },
            // Chart.js가 같은 캔버스에 차트를 재생성해도 이전 위치를 시작점으로 삼지 않도록
            // 값 좌표와 스택 기준점을 모두 0축 픽셀에서 명시적으로 출발시킨다.
            animations: {
                [valueProperty]: {
                    type: 'number',
                    from: zeroPixel,
                    duration,
                    easing: 'easeOutQuart',
                    delay
                },
                base: {
                    type: 'number',
                    from: zeroPixel,
                    duration,
                    easing: 'easeOutQuart',
                    delay
                }
            }
        };
    }

    function doughnutChartEntranceOptions() {
        // 조각별 기본 확대는 끄고 clockwiseReveal 플러그인이 완성된 도넛을 한 방향으로 노출한다.
        return { animation: false };
    }

    function doughnutClockwiseRevealOptions(enabled) {
        return {
            enabled: Boolean(enabled),
            duration: compactChartMotion() ? 850 : 1150
        };
    }

    function lineChartEntranceOptions() {
        // 좌표별 기본 애니메이션은 끄고 lineReveal 플러그인이 완성된 곡선을 연속적으로 노출한다.
        return { animation: false };
    }

    function lineChartRevealOptions(enabled) {
        return {
            enabled: Boolean(enabled),
            duration: compactChartMotion() ? 850 : 1200
        };
    }

    // 완성된 선의 좌표는 움직이지 않고 차트 영역만 왼쪽→오른쪽으로 부드럽게 드러낸다.
    // 데이터 점을 하나씩 재생하던 방식의 지점별 멈춤 현상을 피하기 위한 공용 플러그인이다.
    const lineRevealPlugin = {
        id: 'lineReveal',
        afterInit(chart, _args, options) {
            const enabled = Boolean(options?.enabled);
            chart.$lineRevealProgress = enabled ? 0 : 1;
            if (!enabled) return;

            const duration = Math.max(1, Number(options.duration) || 1200);
            const startAt = performance.now();
            const drawFrame = now => {
                if (!chart.canvas || !chart.canvas.isConnected) return;
                const elapsed = Math.min(1, Math.max(0, (now - startAt) / duration));
                chart.$lineRevealProgress = 1 - Math.pow(1 - elapsed, 3);
                chart.draw();
                if (elapsed < 1) {
                    chart.$lineRevealFrame = requestAnimationFrame(drawFrame);
                } else {
                    chart.$lineRevealFrame = null;
                }
            };
            chart.$lineRevealFrame = requestAnimationFrame(drawFrame);
        },
        beforeDatasetsDraw(chart, _args, options) {
            chart.$lineRevealClipApplied = false;
            if (!options?.enabled || !chart.chartArea) return;

            const { left, right, top, bottom } = chart.chartArea;
            const progress = Math.min(1, Math.max(0, Number(chart.$lineRevealProgress) || 0));
            chart.ctx.save();
            chart.ctx.beginPath();
            chart.ctx.rect(left - 8, top - 8, ((right - left) * progress) + 8, (bottom - top) + 16);
            chart.ctx.clip();
            chart.$lineRevealClipApplied = true;
        },
        afterDatasetsDraw(chart) {
            if (!chart.$lineRevealClipApplied) return;
            chart.ctx.restore();
            chart.$lineRevealClipApplied = false;
        },
        beforeDestroy(chart) {
            if (chart.$lineRevealFrame) cancelAnimationFrame(chart.$lineRevealFrame);
            chart.$lineRevealFrame = null;
        }
    };

    // 도넛 전체를 12시 방향부터 시계방향으로 한 번에 드러내는 각도 마스크.
    // 각 조각이 따로 커지지 않아 카테고리 비중의 순서와 연결감이 자연스럽게 보인다.
    const doughnutClockwiseRevealPlugin = {
        id: 'clockwiseReveal',
        afterInit(chart, _args, options) {
            const enabled = Boolean(options?.enabled);
            chart.$clockwiseRevealProgress = enabled ? 0 : 1;
            if (!enabled) return;

            const duration = Math.max(1, Number(options.duration) || 1150);
            const startAt = performance.now();
            const drawFrame = now => {
                if (!chart.canvas || !chart.canvas.isConnected) return;
                const elapsed = Math.min(1, Math.max(0, (now - startAt) / duration));
                chart.$clockwiseRevealProgress = elapsed < 0.5
                    ? 4 * elapsed * elapsed * elapsed
                    : 1 - Math.pow(-2 * elapsed + 2, 3) / 2;
                chart.draw();
                if (elapsed < 1) {
                    chart.$clockwiseRevealFrame = requestAnimationFrame(drawFrame);
                } else {
                    chart.$clockwiseRevealFrame = null;
                }
            };
            chart.$clockwiseRevealFrame = requestAnimationFrame(drawFrame);
        },
        beforeDatasetsDraw(chart, _args, options) {
            chart.$clockwiseRevealClipApplied = false;
            if (!options?.enabled) return;

            const firstArc = chart.getDatasetMeta(0)?.data?.[0];
            if (!firstArc) return;
            const progress = Math.min(1, Math.max(0, Number(chart.$clockwiseRevealProgress) || 0));
            const radius = Math.max(firstArc.outerRadius || 0, chart.width, chart.height) + 4;
            const startAngle = -Math.PI / 2;

            chart.ctx.save();
            chart.ctx.beginPath();
            chart.ctx.moveTo(firstArc.x, firstArc.y);
            chart.ctx.arc(firstArc.x, firstArc.y, radius, startAngle, startAngle + (Math.PI * 2 * progress), false);
            chart.ctx.closePath();
            chart.ctx.clip();
            chart.$clockwiseRevealClipApplied = true;
        },
        afterDatasetsDraw(chart) {
            if (!chart.$clockwiseRevealClipApplied) return;
            chart.ctx.restore();
            chart.$clockwiseRevealClipApplied = false;
        },
        beforeDestroy(chart) {
            if (chart.$clockwiseRevealFrame) cancelAnimationFrame(chart.$clockwiseRevealFrame);
            chart.$clockwiseRevealFrame = null;
        }
    };

    // 조각 채움색의 밝기에 따라 흰 글씨/잉크 글씨 중 대비가 되는 쪽을 선택
    function pickTextColorForBg(bgColor) {
        if (!bgColor || typeof bgColor !== 'string') return '#ffffff';
        const trimmed = bgColor.trim();
        if (trimmed.startsWith('#')) {
            let hex = trimmed.slice(1);
            if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
            if (hex.length >= 6) {
                const r = parseInt(hex.slice(0, 2), 16) || 0;
                const g = parseInt(hex.slice(2, 4), 16) || 0;
                const b = parseInt(hex.slice(4, 6), 16) || 0;
                const lum = 0.299 * r + 0.587 * g + 0.114 * b;
                return lum > 165 ? '#0f172a' : '#ffffff';
            }
        }
        const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(trimmed);
        if (!m) return '#ffffff';
        const [r, g, b] = [m[1], m[2], m[3]].map(Number);
        const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
        return luminance > 165 ? '#0f172a' : '#ffffff';
    }

    // 차트 위에 값을 직접 그리는 공용 플러그인 — 막대는 끝(tip)에, 도넛은 조각 위/옆에 표시
    // (호버 툴팁 없이도 바로 확인 가능하도록. 개별 차트는 plugins.chartValueLabel 옵션으로 활성화)
    const chartValueLabelPlugin = {
        id: 'chartValueLabel',
        afterDatasetsDraw(chart, _args, opts) {
            if (!opts || !opts.getLabel) return;
            const { ctx } = chart;
            ctx.save();
            const isMobile = typeof window !== 'undefined' && window.innerWidth <= 640;
            ctx.font = isMobile
                ? "700 9.5px 'Malgun Gothic', '맑은 고딕', 'Segoe UI', sans-serif"
                : "600 12px 'Malgun Gothic', '맑은 고딕', 'Segoe UI', sans-serif";
            ctx.textBaseline = 'middle';

            if (chart.config.type === 'doughnut') {
                const meta = chart.getDatasetMeta(0);
                const bgColors = chart.data.datasets[0].backgroundColor;
                meta.data.forEach((arc, i) => {
                    const text = opts.getLabel(i);
                    if (!text) return;
                    const angle = (arc.startAngle + arc.endAngle) / 2;
                    const bigEnough = (arc.endAngle - arc.startAngle) > 0.35;
                    if (bigEnough) {
                        const r = (arc.innerRadius + arc.outerRadius) / 2;
                        ctx.textAlign = 'center';
                        ctx.fillStyle = pickTextColorForBg(Array.isArray(bgColors) ? bgColors[i] : bgColors);
                        ctx.fillText(text, arc.x + Math.cos(angle) * r, arc.y + Math.sin(angle) * r);
                    } else {
                        const x1 = arc.x + Math.cos(angle) * arc.outerRadius;
                        const y1 = arc.y + Math.sin(angle) * arc.outerRadius;
                        const x2 = arc.x + Math.cos(angle) * (arc.outerRadius + 14);
                        const y2 = arc.y + Math.sin(angle) * (arc.outerRadius + 14);
                        ctx.beginPath();
                        ctx.moveTo(x1, y1);
                        ctx.lineTo(x2, y2);
                        ctx.strokeStyle = 'rgba(148,163,184,0.6)';
                        ctx.lineWidth = 1;
                        ctx.stroke();
                        ctx.textAlign = x2 >= arc.x ? 'left' : 'right';
                        ctx.fillStyle = opts.color || '#e2e8f0';
                        ctx.fillText(text, x2 + (x2 >= arc.x ? 4 : -4), y2);
                    }
                });
            } else if (chart.options.indexAxis === 'y') {
                // 가로 막대: 막대 끝(tip)에 표시. getColor(i)가 있으면 항목별 색상(예: 위험도) 우선 적용
                // 막대가 차트 오른쪽 끝까지 차서 바깥에 쓸 공간이 없으면 막대 안쪽에 표시 (라벨 잘림 방지, v1.6.235)
                const meta = chart.getDatasetMeta(0);
                const area = chart.chartArea;
                meta.data.forEach((bar, i) => {
                    const text = opts.getLabel(i);
                    if (!text) return;
                    const textW = ctx.measureText(text).width;
                    if (area && bar.x + 8 + textW > area.right) {
                        const dsBg = chart.data.datasets[0].backgroundColor;
                        let bg = '#6366f1';
                        if (Array.isArray(dsBg)) {
                            bg = dsBg[i];
                        } else if (typeof dsBg === 'function') {
                            const labelName = chart.data.labels ? chart.data.labels[i] : null;
                            bg = labelName ? (getClubColorMap()[labelName] || stableClubHexColor(labelName)) : (bar.options?.backgroundColor || '#6366f1');
                        } else if (typeof dsBg === 'string') {
                            bg = dsBg;
                        } else if (bar.options && typeof bar.options.backgroundColor === 'string') {
                            bg = bar.options.backgroundColor;
                        }
                        ctx.textAlign = 'right';
                        // 막대 내부 표시 시 배경색과 고대비 텍스트(#ffffff 또는 pickTextColorForBg) 및 텍스트 그림자로 가독성 확보
                        ctx.fillStyle = pickTextColorForBg(bg);
                        ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
                        ctx.shadowBlur = 4;
                        ctx.fillText(text, bar.x - 8, bar.y);
                        ctx.shadowBlur = 0;
                    } else {
                        ctx.textAlign = 'left';
                        ctx.fillStyle = (opts.getColor ? opts.getColor(i) : opts.color) || '#e2e8f0';
                        ctx.shadowBlur = 0;
                        ctx.fillText(text, bar.x + 8, bar.y);
                    }
                });
            } else {
                // 세로 막대(단일/스택): 스택 합계를 맨 위 캡에 표시
                const n = chart.data.labels.length;
                const metas = chart.data.datasets.map((_, di) => chart.getDatasetMeta(di));
                const chartArea = chart.chartArea || { top: 0, bottom: chart.height };
                for (let idx = 0; idx < n; idx++) {
                    let topEl = null, total = 0;
                    metas.forEach((meta, di) => {
                        const val = chart.data.datasets[di].data[idx] || 0;
                        total += val;
                        if (val > 0 && !meta.hidden) topEl = meta.data[idx];
                    });
                    if (!topEl || total <= 0) continue;
                    const text = opts.getLabel(idx, total);
                    if (!text) continue;
                    ctx.textAlign = 'center';
                    // 막대가 차트 최상단에 매우 근접한 경우 캔버스 밖으로 잘리지 않도록 막대 내부 상단에 고대비로 표시
                    const isNearTop = topEl.y < chartArea.top + 16;
                    if (isNearTop) {
                        ctx.fillStyle = '#ffffff';
                        ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
                        ctx.shadowBlur = 4;
                        ctx.fillText(text, topEl.x, topEl.y + (isMobile ? 10 : 12));
                        ctx.shadowBlur = 0;
                    } else {
                        // 캔버스 최상단(y=0) 밖으로 튀어나가지 않도록 최소 Y좌표 보장 (상단 잘림 원천 방지)
                        const textY = Math.max(isMobile ? 9 : 12, topEl.y - (isMobile ? 6 : 10));
                        ctx.fillStyle = opts.color || '#e2e8f0';
                        ctx.shadowBlur = 0;
                        ctx.fillText(text, topEl.x, textY);
                    }
                }
            }
            ctx.restore();
        }
    };
    let _chartPluginsRegistered = false;
    function ensureChartPluginsRegistered() {
        if (_chartPluginsRegistered || typeof Chart === 'undefined') return;
        try {
            Chart.register(chartValueLabelPlugin, lineRevealPlugin, doughnutClockwiseRevealPlugin);
            _chartPluginsRegistered = true;
        } catch (_) {}
    }
    ensureChartPluginsRegistered();

    // 클럽 고유 색상 — clubRegistry.chartColor가 최우선이며, 자동 색상은 조화로운 선별 팔레트 안에서
    // 고정 ID 해시로 배정한다. 차트별 정렬·필터가 바뀌어도 같은 클럽은 항상 같은 계열을 유지한다.
    const CLUB_COLOR_PALETTE = [
        '#7c6ee6', '#9b6de3', '#586fd8', '#3f83e0', '#3aa5d9', '#2eafc2',
        '#2eaa91', '#45a66f', '#76a84b', '#d2a23b', '#df8238', '#e46655',
        '#db5e7e', '#d45aa6', '#a85ed0', '#6f66c8', '#4878b8', '#3f9d98'
    ];

    function normalizeClubHexColor(value) {
        return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toLowerCase() : '';
    }

    function stableClubColorIndex(value) {
        const text = String(value || '기본 클럽');
        let hash = 2166136261;
        for (let i = 0; i < text.length; i++) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0) % CLUB_COLOR_PALETTE.length;
    }

    function stableClubHexColor(value) {
        return CLUB_COLOR_PALETTE[stableClubColorIndex(value)];
    }

    function resolveClubBaseColor(clubId, club) {
        return normalizeClubHexColor(club?.chartColor)
            || stableClubHexColor(clubId || club?.name);
    }

    function getClubColorMap() {
        const map = {};
        const claimedAutomaticColors = new Set();
        Object.entries(AppState.clubRegistry || {})
            .filter(([, club]) => club?.name)
            .sort(([leftId], [rightId]) => String(leftId).localeCompare(String(rightId)))
            .forEach(([clubId, club]) => {
                const customColor = normalizeClubHexColor(club.chartColor);
                if (customColor) {
                    map[club.name] = customColor;
                    return;
                }
                const startIndex = stableClubColorIndex(clubId || club.name);
                let color = CLUB_COLOR_PALETTE[startIndex];
                for (let offset = 0; offset < CLUB_COLOR_PALETTE.length; offset++) {
                    const candidate = CLUB_COLOR_PALETTE[(startIndex + offset) % CLUB_COLOR_PALETTE.length];
                    if (!claimedAutomaticColors.has(candidate)) {
                        color = candidate;
                        break;
                    }
                }
                claimedAutomaticColors.add(color);
                map[club.name] = color;
            });
        return map;
    }

    function hexToRgba(hex, alpha = 0.88) {
        const normalized = normalizeClubHexColor(hex) || '#8b5cf6';
        const value = parseInt(normalized.slice(1), 16);
        return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
    }

    function mixHexColor(hex, targetHex = '#ffffff', amount = 0.25) {
        const source = parseInt((normalizeClubHexColor(hex) || '#8b5cf6').slice(1), 16);
        const target = parseInt((normalizeClubHexColor(targetHex) || '#ffffff').slice(1), 16);
        const ratio = Math.min(1, Math.max(0, amount));
        const channels = [16, 8, 0].map(shift => Math.round(
            ((source >> shift) & 255) * (1 - ratio) + ((target >> shift) & 255) * ratio
        ));
        return `#${channels.map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
    }

    // 막대 방향에 맞춰 클럽 고유색을 유지하는 은은한 3단 그라데이션을 만든다.
    function clubBarGradient(context, baseHex, horizontal = false) {
        const chart = context && context.chart;
        if (!chart || !chart.ctx) return hexToRgba(baseHex, 0.9);
        const area = chart.chartArea;
        if (!area) return hexToRgba(baseHex, 0.9);

        // area 좌표가 유효한 유한 숫자인지 철저히 검증 (초기 레이아웃 프레임에서 non-finite로 인한 차트 크래시 원천 차단)
        const x1 = Number(area.left);
        const y1 = Number(horizontal ? 0 : area.bottom);
        const x2 = Number(horizontal ? area.right : 0);
        const y2 = Number(horizontal ? 0 : area.top);

        if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2) || (horizontal && x1 === x2) || (!horizontal && y1 === y2)) {
            return hexToRgba(baseHex, 0.9);
        }

        try {
            const gradient = chart.ctx.createLinearGradient(x1, y1, x2, y2);
            gradient.addColorStop(0, hexToRgba(baseHex, 0.82));
            gradient.addColorStop(0.58, hexToRgba(mixHexColor(baseHex, '#ffffff', 0.12), 0.94));
            gradient.addColorStop(1, hexToRgba(mixHexColor(baseHex, '#ffffff', 0.34), 1));
            return gradient;
        } catch (_err) {
            return hexToRgba(baseHex, 0.9);
        }
    }

    // 클럽 레지스트리에 없는 과거 이력도 이름 해시로 일관된 색을 사용한다.
    function clubColorFor(name, colorMap, alpha = 0.88) {
        const baseColor = colorMap[name] || stableClubHexColor(name);
        return hexToRgba(baseColor, alpha);
    }

    // 차트별 하드코딩 색을 두지 않고 현재 관리자 테마의 텍스트·격자·툴팁 색을 일괄 적용한다.
    const dashboardChartThemePlugin = {
        id: 'dashboardChartTheme',
        beforeUpdate(chart) {
            const colors = ChartBridge().getChartThemeColors();
            const plugins = chart.options.plugins || {};
            if (plugins.legend?.labels) plugins.legend.labels.color = colors.primary;
            if (plugins.tooltip) {
                plugins.tooltip.backgroundColor = colors.tooltip;
                plugins.tooltip.titleColor = colors.tooltipText;
                plugins.tooltip.bodyColor = colors.tooltipText;
                plugins.tooltip.borderColor = colors.grid;
                plugins.tooltip.borderWidth = 1;
            }
            if (plugins.chartValueLabel) plugins.chartValueLabel.color = colors.primary;
            Object.values(chart.options.scales || {}).forEach(scale => {
                if (scale.ticks) scale.ticks.color = colors.secondary;
                if (scale.grid && scale.grid.display !== false) scale.grid.color = colors.grid;
                if (scale.title) scale.title.color = colors.secondary;
            });
            (chart.data.datasets || []).forEach(dataset => {
                if (dataset.pointBorderColor) dataset.pointBorderColor = colors.surface;
                if (chart.config.type === 'doughnut') dataset.borderColor = colors.surface;
            });
        }
    };
    if (typeof Chart !== 'undefined') Chart.register(dashboardChartThemePlugin);
    // 예산 소진율 위험도 색상 (안전/주의/초과) — 소진율 % 라벨 글씨색에만 사용
    function getUsageRiskColor(ratio) {
        const isLight = typeof document !== 'undefined' && document.documentElement.getAttribute('data-app-theme') === 'light';
        if (isLight) {
            return ratio >= 100 ? 'rgb(220, 38, 38)' : ratio >= 80 ? 'rgb(217, 119, 6)' : 'rgb(5, 150, 105)';
        }
        return ratio >= 100 ? 'rgb(248, 113, 113)' : ratio >= 80 ? 'rgb(251, 191, 36)' : 'rgb(52, 211, 153)';
    }

    let overallMonthlyChartInstance = null;

    // ── 월별 클럽 지출 현황 (막대 그래프) ────────────────────────────────
    // 전체 클럽 선택 시: 월별 x축, 클럽별 막대로 그룹화하여 비교
    // 특정 클럽 선택 시: 해당 클럽의 월별 지출액만 표시
    function renderOverallMonthlyChart(historyList, animateEntrance = false) {
        const canvas = document.getElementById('overall-monthly-chart');
        if (!canvas || typeof Chart === 'undefined') return;

        const clubColorMap = getClubColorMap();

        // 월별 x축 + 선택된 클럽별 막대 (중복 선택 가능)
        const monthSet = new Set();
        const clubNames = new Set();
        const spendByMonthClub = {};

        historyList.forEach(entry => {
            const d = entry.settlementDate
                ? new Date(entry.settlementDate + 'T00:00:00')
                : (entry.date ? new Date(entry.date) : new Date(entry.id));
            const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const club = entry.clubName || '기본 클럽';
            monthSet.add(monthKey);
            clubNames.add(club);
            spendByMonthClub[monthKey] = spendByMonthClub[monthKey] || {};
            spendByMonthClub[monthKey][club] = (spendByMonthClub[monthKey][club] || 0) + (entry.totalCost || 0);
        });

        // 클럽 레지스트리에 등록된 클럽도 (지출 0이라도) 표시
        Object.values(AppState.clubRegistry || {}).forEach(club => clubNames.add(club.name));

        const labels = Array.from(monthSet).sort();
        const sortedClubs = Array.from(clubNames)
            .filter(name => !(ChartBridge().getSelectedOverallClubs()) || (ChartBridge().getSelectedOverallClubs()).has(name))
            .sort((a, b) => a.localeCompare(b));

        const datasets = sortedClubs.map((club) => ({
            label: club,
            data: labels.map(month => (spendByMonthClub[month] && spendByMonthClub[month][club]) || 0),
            backgroundColor: context => clubBarGradient(context, clubColorMap[club] || stableClubHexColor(club), false),
            borderColor: clubColorFor(club, clubColorMap, 1),
            borderWidth: 0,
            borderRadius: 6,
            borderSkipped: false
        }));

        const stacked = sortedClubs.length > 1;
        const isMobileScreen = typeof window !== 'undefined' && window.innerWidth <= 640;
        // 차트 표기는 한국 원화 단위(억·만·천)로 통일한다.
        // 축에는 단위를 간결하게, 막대 합계에는 원 단위까지 표시한다. 모바일에서는 초컴팩트(N만)로 겹침 원천 방지.
        const formatKoreanWon = (value, includeWon = false, isCompact = false) => {
            const amount = Math.round(Number(value) || 0);
            if (amount === 0) return includeWon ? '0원' : '0';

            if (isCompact) {
                // 모바일 초컴팩트 표기: 막대 위 텍스트 겹침을 원천 차단하기 위해 2~4글자 고정 (예: 383만, 16만, 9.5만)
                if (amount >= 100000000) {
                    const eokVal = amount / 100000000;
                    return `${Math.round(eokVal * 10) / 10}억`;
                }
                if (amount >= 10000) {
                    const manVal = amount / 10000;
                    return manVal >= 10 ? `${Math.round(manVal)}만` : `${Math.round(manVal * 10) / 10}만`;
                }
                if (amount >= 1000) {
                    return `${Math.round(amount / 1000)}천`;
                }
                return `${amount}`;
            }

            const eok = Math.floor(amount / 100000000);
            const restAfterEok = amount % 100000000;
            const man = Math.floor(restAfterEok / 10000);
            const restWon = restAfterEok % 10000;
            const parts = [];
            if (eok) parts.push(`${eok}억`);
            if (man) parts.push(`${man.toLocaleString('ko-KR')}만`);
            if (restWon >= 1000) parts.push(`${Math.floor(restWon / 1000)}천`);
            if (restWon % 1000) parts.push(`${restWon % 1000}`);
            return `${parts.join(' ')}${includeWon ? '원' : ''}`;
        };
        // 스택 합계 라벨이 막대 위쪽에 잘리지 않도록 y축 최대치에 여유 확보
        const monthTotals = labels.map(month => sortedClubs.reduce((s, c) => s + ((spendByMonthClub[month] && spendByMonthClub[month][c]) || 0), 0));
        const maxTotal = Math.max(0, ...monthTotals);

        if (overallMonthlyChartInstance) overallMonthlyChartInstance.destroy();
        overallMonthlyChartInstance = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                ...barChartEntranceOptions(animateEntrance),
                layout: { padding: { top: isMobileScreen ? 20 : 30, left: 2, right: 6, bottom: 2 } },
                plugins: {
                    // 모바일에서는 바로 위에 클럽 필터 칩이 있으므로 차트 영역을 가리는 5줄 범례를 숨김
                    legend: {
                        display: !isMobileScreen,
                        labels: { color: '#cbd5e1', boxWidth: 10, boxHeight: 10, borderRadius: 3, padding: 8, font: { size: 11 } }
                    },
                    tooltip: {
                        callbacks: {
                            label: ctx => `${ctx.dataset.label}: ${SettlementCalculator.formatCurrency(ctx.parsed.y)}`
                        }
                    },
                    chartValueLabel: {
                        color: '#e2e8f0',
                        getLabel: (_idx, total) => formatKoreanWon(total, false, isMobileScreen)
                    }
                },
                scales: {
                    x: {
                        stacked,
                        ticks: { color: '#94a3b8', font: { size: isMobileScreen ? 10 : 12, weight: '500' }, maxRotation: 45, minRotation: isMobileScreen ? 45 : 0 },
                        grid: { color: 'rgba(255,255,255,0.04)' }
                    },
                    y: {
                        stacked,
                        suggestedMax: Math.ceil(maxTotal * 1.25) || undefined,
                        grace: '15%',
                        title: { display: !isMobileScreen, text: '금액 (원)', color: '#94a3b8', font: { size: 11, weight: '600' } },
                        ticks: {
                            color: '#94a3b8',
                            font: { size: isMobileScreen ? 10 : 11 },
                            callback: value => formatKoreanWon(value, false, isMobileScreen)
                        },
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        beginAtZero: true
                    }
                }
            }
        });
    }

    let clubUsageChartInstance = null;

    // ── 모션 카운트업 (표시 전용) ─────────────────────────────────────────
    // 숫자를 0 → 목표값으로 부드럽게 올린 뒤, 마지막 프레임에서 반드시 formatter(target)
    // 원본 문자열로 확정한다. 진행 중 같은 요소에 값이 다시 기록되면(token 변경) 즉시 중단한다.
    function animateCountUp(el, target, formatter, duration = 900) {
        if (!el || !Number.isFinite(target)) return;
        const token = (el._countUpToken = (el._countUpToken || 0) + 1);
        const finalText = formatter(target);
        if (prefersReducedChartMotion() || target === 0) { el.textContent = finalText; return; }
        const start = performance.now();
        const step = (now) => {
            if (el._countUpToken !== token) return;
            const p = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - p, 3);
            if (p >= 1) { el.textContent = finalText; return; }
            el.textContent = formatter(Math.round(target * eased));
            requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }

    function cancelCountUp(el) {
        if (el) el._countUpToken = (el._countUpToken || 0) + 1;
    }

    // ── 클럽별 예산 소진율 원형 게이지 (v1.6.335) ─────────────────────────
    // 링 색 = 클럽 고유색(getClubColorMap), % 숫자색 = getUsageRiskColor (안전/주의/초과).
    function renderClubUsageRings(host, clubData, clubColorMap, animateEntrance, onSelect) {
        host.innerHTML = '';
        if (!clubData.length) {
            host.innerHTML = '<div class="usage-ring-empty">표시할 클럽이 없습니다.</div>';
            return;
        }
        const R = 42;
        const C = 2 * Math.PI * R;
        const animate = animateEntrance && !prefersReducedChartMotion();
        clubData.forEach((d, idx) => {
            const color = clubColorMap[d.name] || stableClubHexColor(d.name);
            const riskColor = getUsageRiskColor(d.ratio);
            const fill = Math.min(100, Math.max(0, d.ratio));
            const targetOffset = C * (1 - fill / 100);
            const remaining = d.budget - d.usedTotal;
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'usage-ring-item' + (d.ratio >= 100 ? ' is-over' : d.ratio >= 80 ? ' is-warn' : '');
            item.style.setProperty('--ring-color', color);
            item.style.setProperty('--ring-risk', riskColor);
            item.style.setProperty('--ring-delay', `${Math.min(idx * 60, 540)}ms`);
            item.title = `${d.name}\n소진율: ${d.ratio}%\n예산: ${SettlementCalculator.formatCurrency(d.budget)}\n사용: ${SettlementCalculator.formatCurrency(d.usedTotal)}\n잔여: ${SettlementCalculator.formatCurrency(Math.max(0, remaining))}`;
            item.setAttribute('aria-label', `${d.name} 예산 소진율 ${d.ratio}%`);
            item.innerHTML = `
                <span class="usage-ring-svg-wrap">
                    <svg viewBox="0 0 100 100" aria-hidden="true">
                        <circle class="usage-ring-track" cx="50" cy="50" r="${R}"></circle>
                        <circle class="usage-ring-bar" cx="50" cy="50" r="${R}"
                            stroke-dasharray="${C.toFixed(2)}"
                            stroke-dashoffset="${(animate ? C : targetOffset).toFixed(2)}"></circle>
                    </svg>
                    <span class="usage-ring-pct"></span>
                </span>
                <span class="usage-ring-name"></span>
                <span class="usage-ring-sub"></span>`;
            item.querySelector('.usage-ring-name').textContent = d.name;
            item.querySelector('.usage-ring-sub').textContent = `잔여 ${SettlementCalculator.formatCurrency(Math.max(0, remaining))}`;
            const pctEl = item.querySelector('.usage-ring-pct');
            const formatPct = (v) => `${Math.round(v * 10) / 10}%`;
            item.addEventListener('click', () => onSelect && onSelect(d.name));
            host.appendChild(item);
            if (animate) {
                item.classList.add('is-animating');
                const bar = item.querySelector('.usage-ring-bar');
                pctEl.textContent = '0%';
                requestAnimationFrame(() => requestAnimationFrame(() => {
                    bar.style.strokeDashoffset = targetOffset.toFixed(2);
                }));
                // 소수점 1자리 % 카운트업 — 최종 프레임은 d.ratio 원본값으로 확정
                const token = (pctEl._countUpToken = (pctEl._countUpToken || 0) + 1);
                const start = performance.now() + Math.min(idx * 60, 540);
                const duration = 1100;
                const step = (now) => {
                    if (pctEl._countUpToken !== token) return;
                    const p = Math.max(0, Math.min(1, (now - start) / duration));
                    if (p >= 1) { pctEl.textContent = `${d.ratio}%`; return; }
                    pctEl.textContent = formatPct(d.ratio * (1 - Math.pow(1 - p, 3)));
                    requestAnimationFrame(step);
                };
                requestAnimationFrame(step);
            } else {
                pctEl.textContent = `${d.ratio}%`;
            }
        });
    }

    // ── 클럽별 예산 소진율 (가로 막대, 공통 필터 사용) ────────────────────
    function renderClubUsageChart(historyList, animateEntrance = false, targetYear) {
        const canvas = document.getElementById('club-usage-chart');
        if (!canvas || typeof Chart === 'undefined') return;

        const chartYearSelect = document.getElementById('charts-year-select');
        const effectiveYear = targetYear !== undefined ? targetYear : (
            chartYearSelect && chartYearSelect.value !== 'ALL'
                ? (Number(chartYearSelect.value) || new Date().getFullYear())
                : (chartYearSelect && chartYearSelect.value === 'ALL' ? null : new Date().getFullYear())
        );
        const isCurrentYear = effectiveYear === null || effectiveYear === new Date().getFullYear();

        // 클럽 목록: AppState.clubRegistry를 우선하되, historyList에만 있는 클럽도 누락 없이 합집합 구성
        // (클럽 레지스트리 비동기 로딩 지연 시 차트가 빈 화면으로 남는 현상 원천 방지)
        const clubMapByName = new Map();
        Object.values(AppState.clubRegistry || {}).forEach(c => {
            if (c && c.name) {
                clubMapByName.set(c.name, {
                    name: c.name,
                    budget: Math.max(0, Number(c.budget) || 0),
                    priorUsed: Math.max(0, Number(c.priorUsed) || 0)
                });
            }
        });
        (historyList || []).forEach(entry => {
            const cName = entry && entry.clubName ? entry.clubName.trim() : '기본 클럽';
            if (cName && !clubMapByName.has(cName)) {
                clubMapByName.set(cName, {
                    name: cName,
                    budget: AppState.rules?.defaultClubBudget || 4000000,
                    priorUsed: 0
                });
            }
        });

        const allClubs = Array.from(clubMapByName.values())
            .filter(c => c && c.name)
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        const clubs = allClubs.filter(c => !(ChartBridge().getSelectedOverallClubs()) || (ChartBridge().getSelectedOverallClubs()).has(c.name));

        // 소진율 높은 순 정렬
        const clubData = clubs.map(club => {
            const spent = (historyList || [])
                .filter(entry =>
                    (effectiveYear === null || getHistoryEntryYear(entry) === effectiveYear)
                    && (entry.clubName || '기본 클럽') === club.name
                )
                .reduce((sum, entry) => sum + (entry.finalSupportAmount || 0), 0);
            const prior = isCurrentYear ? (club.priorUsed || 0) : 0;
            const usedTotal = prior + spent;
            const budget = club.budget > 0 ? club.budget : (AppState.rules?.defaultClubBudget || 4000000);
            const ratio = budget > 0 ? (usedTotal / budget) * 100 : 0;
            return { name: club.name, ratio: Math.round(ratio * 10) / 10, usedTotal, budget };
        }).sort((a, b) => b.ratio - a.ratio);

        const clubColorMap = getClubColorMap();
        const labels = clubData.map(d => d.name);
        const usageRatio = clubData.map(d => d.ratio);
        if (clubUsageChartInstance) { clubUsageChartInstance.destroy(); clubUsageChartInstance = null; }

        // v1.6.335: 가로 막대 → 모션 원형 게이지(링) 그리드로 교체.
        // 위 clubData 계산(사용액·예산·소진율)은 그대로 두고 표시 방식만 바꾼다.
        const ringHost = document.getElementById('club-usage-rings');
        if (ringHost) {
            canvas.style.display = 'none';
            renderClubUsageRings(ringHost, clubData, clubColorMap, animateEntrance, (clubName) => {
                const clubEntries = (historyList || []).filter(entry =>
                    (effectiveYear === null || getHistoryEntryYear(entry) === effectiveYear)
                    && (entry.clubName || '기본 클럽') === clubName
                );
                ChartBridge().openClubUsageSummaryModal(clubName, clubEntries, effectiveYear || '전체');
            });
            return;
        }
        if (labels.length === 0) return;

        clubUsageChartInstance = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: '예산 소진율',
                    data: usageRatio,
                    backgroundColor: context => {
                        const name = clubData[context.dataIndex]?.name || '기본 클럽';
                        return clubBarGradient(context, clubColorMap[name] || stableClubHexColor(name), true);
                    },
                    borderColor: clubData.map(d => clubColorFor(d.name, clubColorMap, 1)),
                    borderWidth: 0,
                    borderRadius: 8
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                ...barChartEntranceOptions(animateEntrance, 'y'),
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const d = clubData[ctx.dataIndex] || { budget: 0, usedTotal: 0 };
                                const remaining = Math.max(0, d.budget - d.usedTotal);
                                return [
                                    `소진율: ${ctx.parsed.x}%`,
                                    `예산: ${SettlementCalculator.formatCurrency(d.budget)}`,
                                    `사용: ${SettlementCalculator.formatCurrency(d.usedTotal)}`,
                                    `잔여: ${SettlementCalculator.formatCurrency(remaining)}`
                                ];
                            }
                        }
                    },
                    chartValueLabel: {
                        color: '#e2e8f0',
                        getLabel: (i) => `${usageRatio[i]}%`,
                        getColor: (i) => getUsageRiskColor(usageRatio[i])
                    }
                },
                layout: { padding: { right: 16 } },
                scales: {
                    x: { ticks: { color: '#94a3b8', callback: (v) => v + '%' }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true, max: 125 },
                    y: { ticks: { color: '#cbd5e1', font: { size: 12, weight: '500' } }, grid: { display: false } }
                },
                onHover: (_event, elements) => { canvas.style.cursor = elements.length ? 'pointer' : 'default'; },
                onClick: (_event, elements) => {
                    const selected = elements[0];
                    if (!selected) return;
                    const clubName = labels[selected.index];
                    const clubEntries = (historyList || []).filter(entry =>
                        (effectiveYear === null || getHistoryEntryYear(entry) === effectiveYear)
                        && (entry.clubName || '기본 클럽') === clubName
                    );
                    ChartBridge().openClubUsageSummaryModal(clubName, clubEntries, effectiveYear || '전체');
                }
            }
        });
    }

    let categoryPieChartInstance = null;

    // ── 카테고리별(행사비/시설비/상품) 누적 비용 비중 (도넛, 클럽 필터 적용) ─
    function renderCategoryPieChart(historyList, animateEntrance = false) {
        const canvas = document.getElementById('category-pie-chart');
        if (!canvas || typeof Chart === 'undefined') return;

        const filtered = (historyList || []).filter(e =>
            !(ChartBridge().getSelectedOverallClubs()) || (ChartBridge().getSelectedOverallClubs()).has(e.clubName || '기본 클럽')
        );

        let eventCost = 0, facilityCost = 0, prizeCost = 0;
        filtered.forEach(entry => {
            (entry.expenseItems || []).forEach(item => {
                const amt = item.amount || 0;
                if (item.category === 'FACILITY') facilityCost += amt;
                else if (item.category === 'PRIZE') prizeCost += amt;
                else eventCost += amt;
            });
        });

        if (categoryPieChartInstance) categoryPieChartInstance.destroy();
        if (eventCost + facilityCost + prizeCost === 0) return;

        const total = eventCost + facilityCost + prizeCost;
        // v1.6.335: 도넛 중앙에 총 비용 표시 (표시 전용 인라인 플러그인)
        const doughnutCenterTotalPlugin = {
            id: 'doughnutCenterTotal',
            afterDatasetsDraw(chart) {
                const meta = chart.getDatasetMeta(0);
                const arc = meta && meta.data && meta.data[0];
                if (!arc) return;
                const { x, y, innerRadius } = arc.getProps(['x', 'y', 'innerRadius'], true);
                if (!Number.isFinite(x) || !Number.isFinite(y) || !(innerRadius > 24)) return;
                const colors = ChartBridge().getChartThemeColors();
                const ctx = chart.ctx;
                ctx.save();
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                const amountSize = Math.max(11, Math.min(18, innerRadius * 0.26));
                ctx.fillStyle = colors.secondary;
                ctx.font = `600 ${Math.max(10, amountSize * 0.62)}px Pretendard, 'Noto Sans KR', sans-serif`;
                ctx.fillText('총 비용', x, y - amountSize * 0.72);
                ctx.fillStyle = colors.primary;
                ctx.font = `800 ${amountSize}px Pretendard, 'Noto Sans KR', sans-serif`;
                ctx.fillText(SettlementCalculator.formatCurrency(total), x, y + amountSize * 0.42);
                ctx.restore();
            }
        };
        categoryPieChartInstance = new Chart(canvas.getContext('2d'), {
            type: 'doughnut',
            plugins: [doughnutCenterTotalPlugin],
            data: {
                labels: ['행사비', '시설·장비', '상품비'],
                datasets: [{
                    data: [eventCost, facilityCost, prizeCost],
                    backgroundColor: ['rgba(139, 92, 246, 0.88)', 'rgba(56, 189, 248, 0.88)', 'rgba(251, 191, 36, 0.88)'],
                    borderColor: 'rgba(15, 23, 42, 0.6)',
                    borderWidth: 3,
                    hoverOffset: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                ...doughnutChartEntranceOptions(),
                // Chart.js의 rotation 0이 캔버스 12시 방향(-90°)에 해당한다.
                rotation: 0,
                circumference: 360,
                cutout: '62%',
                plugins: {
                    clockwiseReveal: doughnutClockwiseRevealOptions(animateEntrance),
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: '#cbd5e1', padding: 16, font: { size: 12 },
                            // 범례에 금액·비율을 직접 표기 — 호버 없이 바로 확인 가능
                            generateLabels: (chart) => {
                                const data = chart.data;
                                const ds = data.datasets[0];
                                return data.labels.map((label, i) => {
                                    const value = ds.data[i] || 0;
                                    const pct = total > 0 ? Math.round(value / total * 1000) / 10 : 0;
                                    return {
                                        text: `${label}  ${SettlementCalculator.formatCurrency(value)} (${pct}%)`,
                                        fillStyle: ds.backgroundColor[i],
                                        strokeStyle: ds.backgroundColor[i],
                                        fontColor: ChartBridge().getChartThemeColors().primary, // Chart.js v4 범례는 항목별 fontColor로 텍스트색을 그림 — 누락 시 글씨가 안 보임
                                        lineWidth: 0,
                                        index: i
                                    };
                                });
                            }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const pct = total > 0 ? Math.round(ctx.parsed / total * 1000) / 10 : 0;
                                return `${ctx.label}: ${SettlementCalculator.formatCurrency(ctx.parsed)} (${pct}%)`;
                            }
                        }
                    },
                    chartValueLabel: {
                        // 도넛 조각 위/옆에 비율을 직접 표시 — 범례(하단)와 별개로 차트 자체에서 바로 확인 가능
                        getLabel: (i) => {
                            const value = [eventCost, facilityCost, prizeCost][i] || 0;
                            const pct = total > 0 ? Math.round(value / total * 1000) / 10 : 0;
                            return pct > 0 ? `${pct}%` : '';
                        }
                    }
                }
            }
        });
    }

    let selfPayTrendChartInstance = null;

    // ── 자부담 vs 회사지원금 추이 (월별 영역 그래프, 클럽 필터 적용) ─────────
    function renderSelfPayTrendChart(historyList, animateEntrance = false) {
        const canvas = document.getElementById('selfpay-trend-chart');
        if (!canvas || typeof Chart === 'undefined') return;

        // (ChartBridge().getSelectedOverallClubs()) 필터 적용 (다른 차트와 동일)
        const filtered = (historyList || []).filter(entry =>
            !(ChartBridge().getSelectedOverallClubs()) || (ChartBridge().getSelectedOverallClubs()).has(entry.clubName || '기본 클럽')
        );

        const totalSupport = filtered.reduce((sum, entry) => sum + Math.max(0, parseAmount(entry.finalSupportAmount)), 0);
        const totalSelfPay = filtered.reduce((sum, entry) => sum + Math.max(0, parseAmount(entry.totalSelfPay)), 0);
        const totalCombined = totalSupport + totalSelfPay;
        const supportRatioPct = totalCombined > 0 ? ((totalSupport / totalCombined) * 100).toFixed(1) : '0.0';
        const selfPayRatioPct = totalCombined > 0 ? ((totalSelfPay / totalCombined) * 100).toFixed(1) : '0.0';
        const totalSupportEl = document.getElementById('selfpay-trend-total-support');
        const totalSelfPayEl = document.getElementById('selfpay-trend-total-selfpay');
        if (totalSupportEl) {
            totalSupportEl.innerHTML = `${SettlementCalculator.formatCurrency(totalSupport)} <em class="trend-ratio">(${supportRatioPct}%)</em>`;
        }
        if (totalSelfPayEl) {
            totalSelfPayEl.innerHTML = `${SettlementCalculator.formatCurrency(totalSelfPay)} <em class="trend-ratio">(${selfPayRatioPct}%)</em>`;
        }

        const byMonth = {};
        filtered.forEach(entry => {
            const d = entry.settlementDate
                ? new Date(entry.settlementDate + 'T00:00:00')
                : (entry.date ? new Date(entry.date) : new Date(entry.id));
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            if (!byMonth[key]) byMonth[key] = { selfPay: 0, support: 0 };
            byMonth[key].selfPay += entry.totalSelfPay || 0;
            byMonth[key].support += entry.finalSupportAmount || 0;
        });

        const labels = Object.keys(byMonth).sort();

        if (selfPayTrendChartInstance) {
            selfPayTrendChartInstance.destroy();
        }
        if (labels.length === 0) return;

        selfPayTrendChartInstance = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: '회사 지원금',
                        data: labels.map(k => byMonth[k].support),
                        borderColor: 'rgba(52, 211, 153, 1)',
                        backgroundColor: 'rgba(52, 211, 153, 0.12)',
                        fill: true,
                        tension: 0.4,
                        pointRadius: 5,
                        pointHoverRadius: 8,
                        pointBackgroundColor: 'rgba(52, 211, 153, 1)',
                        pointBorderColor: '#0f172a',
                        pointBorderWidth: 2
                    },
                    {
                        label: '자부담 비용',
                        data: labels.map(k => byMonth[k].selfPay),
                        borderColor: 'rgba(248, 113, 113, 1)',
                        backgroundColor: 'rgba(248, 113, 113, 0.12)',
                        fill: true,
                        tension: 0.4,
                        pointRadius: 5,
                        pointHoverRadius: 8,
                        pointBackgroundColor: 'rgba(248, 113, 113, 1)',
                        pointBorderColor: '#0f172a',
                        pointBorderWidth: 2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                ...lineChartEntranceOptions(),
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    lineReveal: lineChartRevealOptions(animateEntrance),
                    legend: { labels: { color: '#cbd5e1', boxWidth: 12, boxHeight: 12, borderRadius: 4, padding: 14 } },
                    tooltip: {
                        callbacks: {
                            label: ctx => {
                                const monthKey = labels[ctx.dataIndex];
                                const mData = byMonth[monthKey] || { selfPay: 0, support: 0 };
                                const monthTotal = (mData.support || 0) + (mData.selfPay || 0);
                                const pct = monthTotal > 0 ? ((ctx.parsed.y / monthTotal) * 100).toFixed(1) : '0.0';
                                return `${ctx.dataset.label}: ${SettlementCalculator.formatCurrency(ctx.parsed.y)} (${pct}%)`;
                            }
                        }
                    }
                },
                scales: {
                    x: { ticks: { color: '#94a3b8', font: { size: 12, weight: '500' } }, grid: { color: 'rgba(255,255,255,0.04)' } },
                    y: { ticks: { color: '#94a3b8', callback: v => v >= 1000000 ? (v/1000000).toFixed(1)+'M' : v >= 1000 ? (v/1000).toFixed(0)+'K' : v }, grid: { color: 'rgba(255,255,255,0.05)' }, beginAtZero: true }
                }
            }
        });
    }


    function renderClubActivityChart(historyList, animateEntrance = false, targetYear) {
        const canvas = document.getElementById('club-activity-chart');
        if (!canvas || typeof Chart === 'undefined') return;

        const chartYearSelect = document.getElementById('charts-year-select');
        const effectiveYear = targetYear !== undefined ? targetYear : (
            chartYearSelect && chartYearSelect.value !== 'ALL'
                ? (Number(chartYearSelect.value) || new Date().getFullYear())
                : (chartYearSelect && chartYearSelect.value === 'ALL' ? null : new Date().getFullYear())
        );

        const countMap = {};
        Object.values(AppState.clubRegistry || {}).forEach(c => { countMap[c.name] = 0; });

        const currentYearEntries = (historyList || []).filter(e => {
            if (!e || ((ChartBridge().getSelectedOverallClubs()) && !(ChartBridge().getSelectedOverallClubs()).has(e.clubName || '기본 클럽'))) return false;
            return effectiveYear === null || getHistoryEntryYear(e) === effectiveYear;
        });
        const entriesByClub = {};
        currentYearEntries.forEach(e => {
            const club = e.clubName || '기본 클럽';
            countMap[club] = (countMap[club] || 0) + 1;
            if (!entriesByClub[club]) entriesByClub[club] = [];
            entriesByClub[club].push(e);
        });

        const sorted = Object.entries(countMap)
            .filter(([name]) => !(ChartBridge().getSelectedOverallClubs()) || (ChartBridge().getSelectedOverallClubs()).has(name))
            .sort((a, b) => b[1] - a[1]);

        const labels = sorted.map(([name]) => name);
        const counts = sorted.map(([, cnt]) => cnt);
        const clubColorMap = getClubColorMap();

        if (clubActivityChartInstance) clubActivityChartInstance.destroy();
        if (labels.length === 0) return;

        clubActivityChartInstance = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: '정산 횟수',
                    data: counts,
                    backgroundColor: context => {
                        const name = labels[context.dataIndex] || '기본 클럽';
                        return clubBarGradient(context, clubColorMap[name] || stableClubHexColor(name), true);
                    },
                    borderColor: labels.map(name => clubColorFor(name, clubColorMap, 1)),
                    borderWidth: 0,
                    borderRadius: 8
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                ...barChartEntranceOptions(animateEntrance, 'y'),
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: ctx => `정산 ${ctx.parsed.x}건 · 막대를 클릭해 사용 요약 확인` } },
                    chartValueLabel: {
                        color: '#e2e8f0',
                        getLabel: (i) => `${counts[i]}건`
                    }
                },
                scales: {
                    // 끝(tip) 라벨이 잘리지 않도록 최대치에 여유 확보
                    x: { ticks: { color: '#94a3b8', stepSize: 1 }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true, suggestedMax: Math.max(...counts, 1) + 1 },
                    y: { ticks: { color: '#cbd5e1', font: { size: 12, weight: '500' } }, grid: { display: false } }
                },
                onHover: (_event, elements) => { canvas.style.cursor = elements.length ? 'pointer' : 'default'; },
                onClick: (_event, elements) => {
                    const selected = elements[0];
                    if (!selected) return;
                    const clubName = labels[selected.index];
                    ChartBridge().openClubUsageSummaryModal(clubName, entriesByClub[clubName] || [], effectiveYear || '전체');
                }
            }
        });
    }

    function normalizeChartAttendees(attendees) {
        return (attendees || [])
            .map(attendee => ({
                name: String(attendee?.name || '이름 없음').trim(),
                employeeId: String(attendee?.employeeId ?? '').trim()
            }))
            .sort((a, b) => `${a.name}${a.employeeId}`.localeCompare(`${b.name}${b.employeeId}`, 'ko-KR'));
    }

    function formatChartAttendee(attendee) {
        return attendee.employeeId ? `${attendee.name} (${attendee.employeeId})` : `${attendee.name} (사번 없음)`;
    }
    window.normalizeChartAttendees = normalizeChartAttendees;
    window.formatChartAttendee = formatChartAttendee;

    // 호버 툴팁은 빠른 확인용으로 이름·사번을 2명씩 묶어 모두 표시한다.
    // 긴 명단은 막대 클릭 후 팝업에서 스크롤·복사까지 할 수 있다.
    function formatChartAttendeeTooltipLines(attendees) {
        const people = normalizeChartAttendees(attendees);
        if (people.length === 0) return ['참석자 상세 정보가 저장되지 않았습니다.'];
        const lines = ['참석자 (이름 / 사번)'];
        for (let index = 0; index < people.length; index += 2) {
            lines.push(people.slice(index, index + 2).map(formatChartAttendee).join(' · '));
        }
        return lines;
    }


    function renderClubUniqueAttendeesChart(historyList, animateEntrance = false, targetYear) {
        const canvas = document.getElementById('club-unique-attendees-chart');
        if (!canvas || typeof Chart === 'undefined') return;

        const chartYearSelect = document.getElementById('charts-year-select');
        const effectiveYear = targetYear !== undefined ? targetYear : (
            chartYearSelect && chartYearSelect.value !== 'ALL'
                ? (Number(chartYearSelect.value) || new Date().getFullYear())
                : (chartYearSelect && chartYearSelect.value === 'ALL' ? null : new Date().getFullYear())
        );

        // 클럽명 → Map(사번 기준 고유키와 표시용 참석자 정보; 사번 없는 참석자는 이름으로 폴백)
        const uniqueMap = {};
        (historyList || [])
            .filter(e => {
                if (!e) return false;
                if ((ChartBridge().getSelectedOverallClubs()) && !(ChartBridge().getSelectedOverallClubs()).has(e.clubName || '기본 클럽')) return false;
                return effectiveYear === null || getHistoryEntryYear(e) === effectiveYear;
            })
            .forEach(e => {
                const club = e.clubName || '기본 클럽';
                if (!uniqueMap[club]) uniqueMap[club] = new Map();
                (e.attendees || []).forEach(a => {
                    if (!a) return;
                    const key = a.employeeId ? `id:${a.employeeId}` : (a.name ? `name:${a.name}` : null);
                    if (key && !uniqueMap[club].has(key)) {
                        uniqueMap[club].set(key, { name: a.name || '이름 없음', employeeId: a.employeeId || '' });
                    }
                });
            });

        const sorted = Object.entries(uniqueMap)
            .map(([name, attendeeMap]) => [name, attendeeMap.size, Array.from(attendeeMap.values())])
            .sort((a, b) => b[1] - a[1]);

        if (clubUniqueAttendeesChartInstance) clubUniqueAttendeesChartInstance.destroy();
        if (sorted.length === 0) return;

        const labels = sorted.map(([name]) => name);
        const counts = sorted.map(([, cnt]) => cnt);
        const clubColorMap = getClubColorMap();

        clubUniqueAttendeesChartInstance = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: '참석 인원 (중복 제외)',
                    data: counts,
                    backgroundColor: context => {
                        const name = labels[context.dataIndex] || '기본 클럽';
                        return clubBarGradient(context, clubColorMap[name] || stableClubHexColor(name), true);
                    },
                    borderColor: labels.map(name => clubColorFor(name, clubColorMap, 1)),
                    borderWidth: 0,
                    borderRadius: 8
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                ...barChartEntranceOptions(animateEntrance, 'y'),
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            title: items => {
                                const yrStr = effectiveYear ? `${effectiveYear}년 ` : '';
                                return `${sorted[items[0].dataIndex][0]} · ${yrStr}실 참석자`;
                            },
                            label: ctx => {
                                const attendees = sorted[ctx.dataIndex][2];
                                return [`서로 다른 참석자 ${ctx.parsed.x}명`, ...formatChartAttendeeTooltipLines(attendees)];
                            },
                            footer: () => '막대를 클릭하면 명단 팝업에서 전체 확인·복사가 가능합니다.'
                        }
                    },
                    chartValueLabel: {
                        color: '#e2e8f0',
                        getLabel: (i) => `${counts[i]}명`
                    }
                },
                scales: {
                    x: { ticks: { color: '#94a3b8', stepSize: 1 }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true, suggestedMax: Math.max(...counts, 1) + 1 },
                    y: { ticks: { color: '#cbd5e1', font: { size: 12, weight: '500' } }, grid: { display: false } }
                },
                onHover: (_event, elements) => { canvas.style.cursor = elements.length ? 'pointer' : 'default'; },
                onClick: (_event, elements) => {
                    const selected = elements[0];
                    if (!selected) return;
                    const [club, count, attendees] = sorted[selected.index];
                    const yrStr = effectiveYear ? `${effectiveYear}년 ` : '';
                    ChartBridge().openAttendanceRosterModal(`${club} ${yrStr}실 참석자 명단`, `서로 다른 참석자 ${count}명`, attendees);
                }
            }
        });

        // 제목줄 중앙: 3M 팀워크 모임 애니메이션 GIF 위젯 (순수 관람용)
        renderClubGatheringCartoon();
    }

    let _cartoonAnimationTimer = null;

    // ── 클럽 실 참석 카드 헤더: 3M 팀워크 모임 애니메이션 GIF 위젯 (순수 관람용) ──
    function renderClubGatheringCartoon() {
        const container = document.getElementById('club-gathering-cartoon');
        if (!container) return;

        if (_cartoonAnimationTimer) {
            clearInterval(_cartoonAnimationTimer);
            _cartoonAnimationTimer = null;
        }

        container.style.display = 'inline-flex';
        container.removeAttribute('title');
        container.onclick = null;
        container.innerHTML = `
            <img src="assets/3m_teamwork_gathering_center.gif" alt="3M 팀워크 모임 애니메이션" class="cartoon-teamwork-gif" loading="eager" />
        `;
    }


    function renderRecentSettlements(historyList) {
        const container = document.getElementById('recent-settlement-list');
        if (!container) return;
        const subtitleEl = document.getElementById('recent-settlement-subtitle');
        const selectedClubs = ChartBridge().getSelectedOverallClubs();

        // 입력(등록) 날짜·시간 추출: entry.date 또는 timestamp형 entry.id 우선 (행사일 settlementDate와 무관)
        const getCreatedTimestamp = entry => {
            if (!entry || typeof entry !== 'object') return 0;
            if (entry.date) {
                const t = new Date(entry.date).getTime();
                if (Number.isFinite(t) && t > 0) return t;
            }
            const idNum = Number(entry.id);
            if (Number.isFinite(idNum) && idNum > 100000000000) return idNum;
            if (typeof entry.settlementDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(entry.settlementDate)) {
                const [y, m, d] = entry.settlementDate.slice(0, 10).split('-').map(Number);
                return new Date(y, m - 1, d).getTime();
            }
            return 0;
        };

        const clubFiltered = (historyList || [])
            .filter(entry => entry && (!selectedClubs || selectedClubs.has(entry.clubName || '기본 클럽')))
            .slice()
            .sort((a, b) => getCreatedTimestamp(b) - getCreatedTimestamp(a));

        const now = new Date();
        const isCurrentYearView = !_selectedQueryYear || _selectedQueryYear === 'ALL' || _selectedQueryYear === String(now.getFullYear());
        const refDate = isCurrentYearView
            ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
            : (clubFiltered[0] ? new Date(getCreatedTimestamp(clubFiltered[0])) : new Date(now.getFullYear(), now.getMonth(), now.getDate()));
        const cutoffTime = new Date(refDate.getFullYear(), refDate.getMonth() - 2, refDate.getDate()).getTime();

        const entries = clubFiltered.filter(entry => {
            const ts = getCreatedTimestamp(entry);
            return ts > 0 && ts >= cutoffTime;
        });

        if (subtitleEl) {
            subtitleEl.textContent = `최근 2개월 입력순 (${entries.length}건) · 클릭 시 정산 내역 확인`;
        }
        if (entries.length === 0) {
            container.innerHTML = '<div class="recent-settlement-empty">최근 2개월 내 입력된 정산 이력이 없습니다.</div>';
            return;
        }
        const formatCreatedShort = ts => {
            if (!ts) return '';
            const dt = new Date(ts);
            if (Number.isNaN(dt.getTime())) return '';
            const pad = n => String(n).padStart(2, '0');
            return `${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
        };
        const nowMs = Date.now();
        const ONE_DAY_MS = 24 * 60 * 60 * 1000;
        const colorMap = getClubColorMap();
        container.innerHTML = entries.map((entry, index) => {
            const clubName = entry.clubName || '기본 클럽';
            const dateText = entry.settlementDate || (entry.date ? String(entry.date).slice(0, 10) : '날짜 없음');
            const createdTs = getCreatedTimestamp(entry);
            const isRecentNew = createdTs > 0 && (nowMs - createdTs) <= ONE_DAY_MS;
            const newBadge = isRecentNew ? '<span class="recent-settlement-new-badge">NEW</span>' : '';
            const createdText = formatCreatedShort(createdTs);
            const createdSpan = createdText ? `<span style="opacity:0.78;">입력 ${AppState.escapeHtml(createdText)}</span>` : '';
            const creator = entry.creatorName ? `<span>정산인 ${AppState.escapeHtml(entry.creatorName)}</span>` : '';
            const support = Math.max(0, parseAmount(entry.finalSupportAmount));
            const memberCount = ChartBridge().getHistoryUsageBreakdown(entry).memberCount;
            const baseColor = colorMap[clubName] || stableClubHexColor(clubName);
            return `
                <button type="button" class="recent-settlement-item" data-recent-index="${index}" style="--club-color:${baseColor};" aria-label="${AppState.escapeHtml(clubName)} ${AppState.escapeHtml(dateText)} 정산 내역 확인">
                    <span class="recent-settlement-dot" aria-hidden="true"></span>
                    <div class="recent-settlement-copy">
                        <strong>${AppState.escapeHtml(clubName)} 정산 완료${newBadge}</strong>
                        <small class="recent-settlement-meta"><span>행사 ${AppState.escapeHtml(dateText)}</span>${createdSpan}<span class="recent-settlement-attendees">👥 참석 ${memberCount}명</span>${creator}</small>
                    </div>
                    <span class="recent-settlement-amount">${SettlementCalculator.formatCurrency(support)}</span>
                </button>
            `;
        }).join('');
        container.querySelectorAll('.recent-settlement-item').forEach(button => {
            button.addEventListener('click', () => {
                const entry = entries[Number(button.dataset.recentIndex)];
                if (!entry) return;
                if (typeof ChartBridge().openSettlementDetailModal === 'function') {
                    ChartBridge().openSettlementDetailModal(entry);
                    return;
                }
                if (typeof window.openSettlementDetailModal === 'function') {
                    window.openSettlementDetailModal(entry);
                    return;
                }
                const clubName = entry.clubName || '기본 클럽';
                const dateText = entry.settlementDate || (entry.date ? String(entry.date).slice(0, 10) : '날짜 없음');
                const memberCount = ChartBridge().getHistoryUsageBreakdown(entry).memberCount;
                ChartBridge().openAttendanceRosterModal(
                    `${clubName} ${dateText} 참석자 명단`,
                    `참석 ${memberCount}명`,
                    Array.isArray(entry.attendees) ? entry.attendees : []
                );
            });
        });
    }

    // 차트 탭의 모든 그래프를 한 번에 갱신
    function renderAllCharts(rawHistoryList, { allowEntranceAnimation = false } = {}) {
        if (typeof Chart === 'undefined') {
            console.warn('[Chart] Chart.js 라이브러리가 아직 준비되지 않았습니다. 200ms 후 재시도합니다.');
            setTimeout(() => {
                if (typeof Chart !== 'undefined') {
                    renderAllCharts(rawHistoryList, { allowEntranceAnimation });
                }
            }, 200);
            return;
        }

        if (rawHistoryList && Array.isArray(rawHistoryList)) {
            ChartBridge().setCachedChartHistoryList(rawHistoryList);
        }

        const historyList = ((ChartBridge().getCachedChartHistoryList()) || [])
            .filter(e => e && !(ChartBridge().getCachedDeletedIds())[String(e.id)]);

        const thisYear = new Date().getFullYear();
        if (!_selectedQueryYear) {
            _selectedQueryYear = String(thisYear);
        }
        ChartBridge().updateGlobalYearPickerUI(_selectedQueryYear);

        const isAllYears = _selectedQueryYear === 'ALL';
        const targetYear = isAllYears ? null : (Number(_selectedQueryYear) || thisYear);

        // 연도별 필터링된 이력 목록
        const yearFilteredList = historyList.filter(e => {
            if (isAllYears) return true;
            return getHistoryEntryYear(e) === targetYear;
        });

        ensureChartPluginsRegistered();
        const animateEntrance = allowEntranceAnimation ? consumeChartEntranceAnimation() : false;
        updateChartsBudgetStats(historyList, targetYear);
        if (animateEntrance) {
            // KPI 숫자 카운트업 (표시 전용 — 마지막 프레임은 updateChartsBudgetStats가 쓴 원본값으로 확정)
            ['charts-total-budget', 'charts-used-budget', 'charts-remaining-budget'].forEach(id => {
                const el = document.getElementById(id);
                if (el && el.dataset.countValue !== undefined) {
                    animateCountUp(el, Number(el.dataset.countValue), v => SettlementCalculator.formatCurrency(v));
                }
            });
            const countKpiEl = document.getElementById('charts-total-count');
            if (countKpiEl && countKpiEl.dataset.countValue !== undefined) {
                animateCountUp(countKpiEl, Number(countKpiEl.dataset.countValue), v => `${v}건`, 700);
            }
        }
        renderOverallMonthlyChart(yearFilteredList, animateEntrance);
        renderClubUsageChart(historyList, animateEntrance, targetYear);
        renderCategoryPieChart(yearFilteredList, animateEntrance);
        renderClubActivityChart(historyList, animateEntrance, targetYear);
        renderClubUniqueAttendeesChart(historyList, animateEntrance, targetYear);
        renderSelfPayTrendChart(yearFilteredList, animateEntrance);
        const recentSourceList = (isAllYears || targetYear === thisYear) ? historyList : yearFilteredList;
        renderRecentSettlements(recentSourceList);
    }


    window.renderAllCharts = renderAllCharts;
    window.updateChartsBudgetStats = updateChartsBudgetStats;
    window.getClubColorMap = getClubColorMap;
    window.clubColorFor = clubColorFor;
    window.resolveClubBaseColor = resolveClubBaseColor;
    window.requestChartEntranceAnimation = requestChartEntranceAnimation;
})();
