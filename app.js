// 전역 차트 인스턴스와 데이터 저장용 변수
let cpiChartInstance = null;
let empChartInstance = null;

let cpiGlobalData = { labels: [], datasets: [] };
let empGlobalData = { labels: [], datasets: [] };

/** CPI 그래프 범례: KOSIS 「데이터」 열 이름 → 소비자 물가지수 */
function formatCpiDatasetLabel(label) {
    const s = String(label ?? '').trim();
    if (!s || s === '데이터' || /^데이터\s*\d*$/.test(s) || /^data$/i.test(s)) return '소비자 물가지수';
    if (/^소비자\s*물가\s*지수$/i.test(s) || s === '소비자물가지수') return '소비자 물가지수';
    if ((/CPI|물가지수|물가\s*지수/i.test(s) || s === '지수') && !/고용|실업/.test(s)) return '소비자 물가지수';
    return s;
}

function normalizeCpiDatasets(datasets) {
    return datasets.map(ds => ({ ...ds, label: formatCpiDatasetLabel(ds.label) }));
}

/** KOSIS 「계」(종합) 표기를 학생용 「전체」로 표시 */
function formatDatasetLabel(label) {
    if (label == null) return label;
    const s = String(label);
    return s.replace(/^계\s+/, '전체 ').replace(/^계(?=[가-힣])/u, '전체');
}

function isTotalAggregateLabel(label) {
    const s = String(label);
    return s.startsWith('전체 ') || s.startsWith('계 ') || /^계[가-힣]/u.test(s);
}

/** 격차 그래프 단위: % 지표는 %p, 인구 수 지표는 KOSIS와 동일(천 명) */
function getEmpGapUnit(indicator) {
    if (['경제활동참가율', '실업률', '고용률'].includes(indicator)) return '%p';
    return '천 명';
}

function formatEmpGapLabel(indicator, kind) {
    const unit = getEmpGapUnit(indicator);
    if (kind === 'gender') return `${indicator} 차이(남성−여성, ${unit})`;
    return `${indicator} 차이(비농가−농가, ${unit})`;
}

// 데이터셋 라벨 정렬 우선순위 (지표 종류 → 세부 분류)
function getDatasetSortKey(label) {
    const indicatorOrder = ['경제활동참가율', '실업률', '고용률', '취업자', '실업자', '경제활동인구', '비경제활동인구'];
    const groupOrder = ['전체', '계', '남자', '여자', '농가', '비농가'];

    let indicatorIdx = indicatorOrder.findIndex(k => label.includes(k));
    if (indicatorIdx === -1) indicatorIdx = 99;

    let groupIdx = groupOrder.findIndex(k => label.startsWith(k) || label.includes(` ${k}`));
    if (groupIdx === -1) groupIdx = 50;

    const isPercent = label.includes('%') || label.includes('율') ? 0 : 1;

    return `${String(groupIdx).padStart(2, '0')}_${String(indicatorIdx).padStart(2, '0')}_${isPercent}_${label}`;
}

function sortDatasets(datasets) {
    return [...datasets].sort((a, b) => getDatasetSortKey(a.label).localeCompare(getDatasetSortKey(b.label), 'ko'));
}

function parseYouTubeVideoId(input) {
    const s = String(input ?? '').trim();
    if (!s) return '';
    if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
    const m = s.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|shorts\/|live\/)|[?&]v=)([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : '';
}

function getYouTubeEmbedOrigin() {
    const configured = String(window.ECOMATH_SITE_ORIGIN || '').trim();
    if (configured) return configured.replace(/\/$/, '');
    const origin = window.location.origin || '';
    if (origin && origin !== 'null' && !origin.startsWith('file')) return origin;
    return '';
}

function buildYouTubeEmbedSrc(videoId) {
    const params = new URLSearchParams({
        rel: '0',
        modestbranding: '1',
        playsinline: '1',
    });
    const origin = getYouTubeEmbedOrigin();
    if (origin) params.set('origin', origin);
    return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
}

function initUsageVideo() {
    const videoInput = window.ECOMATH_USAGE_VIDEO;
    const videoId = parseYouTubeVideoId(videoInput);
    const iframe = document.getElementById('usage-video-iframe');
    const extLink = document.getElementById('usage-video-youtube-link');
    if (!videoId || !iframe) return;

    iframe.src = buildYouTubeEmbedSrc(videoId);
    if (extLink) {
        extLink.href = `https://www.youtube.com/watch?v=${videoId}`;
    }

    const fileWarnId = 'usage-video-file-warn';
    let fileWarn = document.getElementById(fileWarnId);
    if (window.location.protocol === 'file:') {
        if (!fileWarn && iframe.parentElement?.parentElement) {
            fileWarn = document.createElement('p');
            fileWarn.id = fileWarnId;
            fileWarn.className = 'mt-3 text-center text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2';
            fileWarn.textContent = 'PC에서 파일로 바로 열면 영상이 재생되지 않을 수 있습니다. GitHub Pages 주소로 접속하거나 「유튜브에서 크게 보기」를 이용하세요.';
            iframe.parentElement.parentElement.appendChild(fileWarn);
        }
    } else if (fileWarn) {
        fileWarn.remove();
    }
}

function revealChartPanel(captureAreaId) {
    const panel = document.getElementById(captureAreaId);
    if (!panel) return;
    panel.classList.remove('hidden');
    requestAnimationFrame(() => {
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
}

function categorizeDataset(label) {
    if (isTotalAggregateLabel(label) || label.includes(' 계 ')) return '전체 종합';
    if (label.startsWith('남자') || label.startsWith('여자')) return '성별 (남자/여자)';
    if (label.startsWith('농가')) return '농가';
    if (label.startsWith('비농가')) return '비농가';
    return '기타';
}

// 필터 UI 생성 함수 (카테고리별 분류 + 정렬)
function renderFilterCheckboxes(containerId, datasets, updateCallback, colorClass) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    const categoryOrder = ['전체 종합', '성별 (남자/여자)', '농가', '비농가', '기타'];
    const categories = Object.fromEntries(categoryOrder.map(name => [name, []]));

    sortDatasets(datasets).forEach(ds => {
        categories[categorizeDataset(ds.label)].push(ds);
    });

    for (const categoryName of categoryOrder) {
        const items = categories[categoryName];
        if (items.length === 0) continue;

        const categoryHeader = document.createElement('h5');
        categoryHeader.className = 'filter-category w-full text-sm font-bold text-gray-800 border-b border-gray-200 pb-1 mt-4 mb-2 first:mt-0';
        categoryHeader.textContent = `■ ${categoryName}`;
        categoryHeader.dataset.category = categoryName;
        container.appendChild(categoryHeader);

        const groupContainer = document.createElement('div');
        groupContainer.className = 'filter-group flex flex-wrap gap-2 mb-2 w-full';
        groupContainer.dataset.category = categoryName;

        items.forEach(ds => {
            // 처음에는 모든 체크박스를 해제 상태로 둡니다 (너무 많아서 복잡해짐 방지)
            // 비율(%) 지표 중 '전체 종합(계)'인 것만 기본으로 몇 개 켜둡니다.
            let isChecked = false;
            if (datasets.length > 3) {
                if (isTotalAggregateLabel(ds.label) && (ds.label.includes('%') || ds.label.includes('율'))) {
                    isChecked = true;
                }
            } else {
                isChecked = true; // CPI처럼 항목이 적은 경우는 모두 켜둠
            }

            const label = document.createElement('label');
            label.className = 'filter-item flex items-center space-x-2 cursor-pointer p-1.5 px-3 bg-white border border-gray-200 rounded-lg shadow-sm hover:bg-gray-50 transition text-sm';
            label.dataset.label = ds.label;
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = ds.label;
            checkbox.checked = isChecked;
            checkbox.className = `form-checkbox text-${colorClass}-600 rounded w-4 h-4 focus:ring-0`;
            checkbox.addEventListener('change', updateCallback);
            
            const span = document.createElement('span');
            span.className = 'text-gray-700 font-medium';
            span.textContent = ds.label;
            span.title = ds.label;
            
            label.appendChild(checkbox);
            label.appendChild(span);
            groupContainer.appendChild(label);
        });

        container.appendChild(groupContainer);
    }
}

function setupFilterSearch(searchInputId, containerId) {
    const searchInput = document.getElementById(searchInputId);
    if (!searchInput) return;

    searchInput.value = '';
    searchInput.oninput = () => {
        const query = searchInput.value.trim().toLowerCase();
        const container = document.getElementById(containerId);
        container.querySelectorAll('.filter-item').forEach(item => {
            const text = (item.dataset.label || '').toLowerCase();
            item.classList.toggle('hidden', query !== '' && !text.includes(query));
        });
        container.querySelectorAll('.filter-category, .filter-group').forEach(group => {
            const visible = group.querySelectorAll('.filter-item:not(.hidden)').length > 0;
            group.classList.toggle('hidden', query !== '' && !visible);
        });
    };
}

// 필터링된 데이터셋 가져오는 함수
function getFilteredDatasets(containerId, datasets) {
    const container = document.getElementById(containerId);
    const checkedValues = Array.from(container.querySelectorAll('input:checked')).map(cb => cb.value);
    
    // 만약 모두 체크 해제되었다면 빈 차트가 나오게 됨
    return datasets.filter(ds => checkedValues.includes(ds.label));
}

const CHART_COLORS = ['#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#6366f1', '#f97316', '#3b82f6', '#10b981'];

function parseNumeric(val) {
    if (val === null || val === undefined || val === '') return null;
    const num = parseFloat(String(val).replace(/,/g, '').replace(/%/g, ''));
    return isNaN(num) ? null : num;
}

function isTimeLikeValue(val) {
    const s = String(val).trim();
    return /^[0-9]{4}(\.[0-9]{1,2})?(\s*(년|월|분기|Q))?/i.test(s) || /^[0-9]{4}$/.test(s);
}

function isTimeFieldName(field) {
    if (!field) return false;
    const f = String(field);
    return f.includes('시점') || f.includes('기간') || f.includes('연도') || (f.includes('년') && !f.includes('천명'));
}

function sortTimeLabels(labels) {
    return [...labels].sort((a, b) => String(a).localeCompare(String(b)));
}

function makeDataset(label, values, colorIdx, defaultColor, fill = false) {
    const color = CHART_COLORS[colorIdx % CHART_COLORS.length] || defaultColor;
    return {
        label: formatDatasetLabel(label),
        data: values,
        borderColor: color,
        backgroundColor: color + '33',
        fill,
        tension: 0.1,
        pointRadius: 2
    };
}

function scoreParseResult(result) {
    if (!result.labels.length || !result.datasets.length) return 0;
    const numericCount = result.datasets.reduce((sum, ds) =>
        sum + ds.data.filter(v => v !== null).length, 0);
    return numericCount + result.datasets.length * 10 + result.labels.length;
}

// 와이드 포맷: 시간이 열 헤더 (고용 기본 다운로드)
function parseWideColumns(data, fields, defaultColor) {
    const wideTimeCols = fields.filter(f => /^[0-9]{4}/.test(String(f)));
    if (wideTimeCols.length === 0) return null;

    const labels = sortTimeLabels(wideTimeCols);
    const nonTimeCols = fields.filter(f => !wideTimeCols.includes(f));
    const datasets = [];
    let colorIdx = 0;

    data.forEach((row, i) => {
        if (wideTimeCols.every(col => !row[col] || String(row[col]).trim() === '')) return;
        const rowLabel = nonTimeCols.map(c => row[c]).filter(v => v).join(' ') || `데이터 ${i + 1}`;
        const values = labels.map(col => parseNumeric(row[col]));
        if (values.some(v => v !== null)) {
            datasets.push(makeDataset(rowLabel, values, colorIdx++, defaultColor));
        }
    });

    return datasets.length ? { labels, datasets } : null;
}

// 시점이 행(세로)인 포맷: 첫 열이 시점, 나머지 열이 항목
function parseTimeRows(data, fields, defaultColor) {
    const timeField = fields.find(isTimeFieldName) || fields[0];
    const timeRows = data.filter(r => isTimeLikeValue(r[timeField]));
    if (timeRows.length < data.length * 0.5) return null;

    const labels = sortTimeLabels([...new Set(timeRows.map(r => String(r[timeField])))]);
    const valueCols = fields.filter(f => f !== timeField && data.some(r => parseNumeric(r[f]) !== null));
    if (!valueCols.length) return null;

    const datasets = valueCols.map((col, i) => {
        const values = labels.map(l => {
            const row = timeRows.find(r => String(r[timeField]) === l);
            return row ? parseNumeric(row[col]) : null;
        });
        return makeDataset(col, values, i, defaultColor);
    }).filter(ds => ds.data.some(v => v !== null));

    return datasets.length ? { labels, datasets } : null;
}

// 롱 포맷: 시점 + 항목 + 데이터 (행렬 전환 후)
function parseLongFormat(data, fields, defaultColor) {
    const xField = fields.find(isTimeFieldName) || fields.find(f => data.some(r => isTimeLikeValue(r[f]))) || fields[0];
    const yField = fields.includes('데이터') ? '데이터' : fields.find(f => f !== xField && data.some(r => parseNumeric(r[f]) !== null)) || fields[fields.length - 1];
    const groupFields = fields.filter(f => f !== xField && f !== yField);

    const labels = sortTimeLabels([...new Set(data.map(r => String(r[xField])).filter(v => v && v !== 'undefined'))]);
    if (!labels.length) return null;

    const datasets = [];

    if (groupFields.length > 0) {
        const grouped = {};
        data.forEach(row => {
            const groupKey = groupFields.map(f => row[f]).filter(v => v).join(' ');
            if (!groupKey) return;
            if (!grouped[groupKey]) grouped[groupKey] = {};
            grouped[groupKey][row[xField]] = parseNumeric(row[yField]);
        });

        let colorIdx = 0;
        for (const [key, valObj] of Object.entries(grouped)) {
            const values = labels.map(l => valObj[l] ?? null);
            if (values.some(v => v !== null)) {
                datasets.push(makeDataset(key, values, colorIdx++, defaultColor));
            }
        }
    } else {
        const values = labels.map(l => {
            const row = data.find(r => String(r[xField]) === l);
            return row ? parseNumeric(row[yField]) : null;
        });
        datasets.push(makeDataset(yField, values, 0, defaultColor, true));
    }

    return datasets.length ? { labels, datasets } : null;
}

// KOSIS 데이터 파싱 (여러 포맷 자동 감지)
function parseKosisData(data, meta, defaultColor) {
    const fields = meta.fields.filter(f => f && !f.startsWith('_'));

    const strategies = [
        () => parseWideColumns(data, fields, defaultColor),
        () => parseTimeRows(data, fields, defaultColor),
        () => parseLongFormat(data, fields, defaultColor)
    ];

    let best = null;
    let bestScore = 0;

    for (const strategy of strategies) {
        const result = strategy();
        if (!result) continue;
        const s = scoreParseResult(result);
        if (s > bestScore) {
            bestScore = s;
            best = result;
        }
    }

    if (!best) throw new Error('지원하지 않는 CSV 형식입니다. KOSIS에서 행렬을 세로로 전환했는지 확인해 주세요.');

    if (best.datasets.length === 1) {
        best.datasets[0].fill = true;
        best.datasets[0].borderColor = defaultColor;
        best.datasets[0].backgroundColor = defaultColor + '33';
    }

    return best;
}

function showError(element, message) {
    element.textContent = message;
    element.classList.remove('hidden');
}

// CPI 차트 업데이트 함수 (슬라이더 값에 따라)
function updateCpiChart() {
    if (!cpiGlobalData.labels.length) return;

    let startIdx = parseInt(document.getElementById('cpi-slider-start').value);
    let endIdx = parseInt(document.getElementById('cpi-slider-end').value);

    // 시작이 끝보다 크면 교정
    if (startIdx > endIdx) {
        let temp = startIdx;
        startIdx = endIdx;
        endIdx = temp;
    }

    const slicedLabels = cpiGlobalData.labels.slice(startIdx, endIdx + 1);
    
    // 1. 선택된 체크박스에 따라 데이터셋 필터링
    const normalizedCpi = normalizeCpiDatasets(cpiGlobalData.datasets);
    let filteredDatasets = getFilteredDatasets('cpi-filter-checkboxes', normalizedCpi);
    if (!filteredDatasets.length) {
        filteredDatasets = normalizedCpi;
    }
    
    // 2. 데이터셋 배열의 데이터들도 슬라이더에 맞춰 잘라줌
    const slicedDatasets = filteredDatasets.map(ds => {
        return {
            ...ds,
            label: formatCpiDatasetLabel(ds.label),
            data: ds.data.slice(startIdx, endIdx + 1)
        };
    });

    // 라벨 텍스트 업데이트
    const labelSpan = document.getElementById('cpi-range-label');
    labelSpan.textContent = `${slicedLabels[0]} ~ ${slicedLabels[slicedLabels.length - 1]}`;

    if (cpiChartInstance) cpiChartInstance.destroy();

    const ctx = document.getElementById('cpiChart').getContext('2d');
    cpiChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: slicedLabels,
            datasets: slicedDatasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top' },
            }
        }
    });
}

// 고용 지표 차트 업데이트 함수 (슬라이더 및 분석 조건에 따라)
function updateEmpChart() {
    if (!empGlobalData.labels.length) return;

    let startIdx = parseInt(document.getElementById('emp-slider-start').value);
    let endIdx = parseInt(document.getElementById('emp-slider-end').value);

    if (startIdx > endIdx) {
        let temp = startIdx;
        startIdx = endIdx;
        endIdx = temp;
    }

    const slicedLabels = empGlobalData.labels.slice(startIdx, endIdx + 1);
    
    // UI 요소 읽기
    const indicator = document.getElementById('emp-indicator-select').value;
    const exploreType = document.querySelector('input[name="emp-explore-radio"]:checked').value;
    
    let targetDatasets = [];
    const allDatasets = empGlobalData.datasets;

    // 분석 조건에 따른 데이터셋 필터링 및 생성
    if (exploreType === 'all') {
        // '계' + 선택한 지표
        const ds = allDatasets.find(d => isTotalAggregateLabel(d.label) && d.label.includes(indicator));
        if (ds) targetDatasets.push(ds);
        // 만약 '계'가 없다면 그냥 지표 이름이 포함된 첫번째 것 선택
        else {
            const fallback = allDatasets.find(d => d.label.includes(indicator));
            if (fallback) targetDatasets.push(fallback);
        }
    }
    else if (exploreType === 'gender') {
        const maleDs = allDatasets.find(d => d.label.startsWith('남자') && d.label.includes(indicator));
        const femaleDs = allDatasets.find(d => d.label.startsWith('여자') && d.label.includes(indicator));
        if (maleDs) {
            maleDs.borderColor = '#3b82f6'; // 파란색
            maleDs.backgroundColor = '#3b82f633';
            targetDatasets.push(maleDs);
        }
        if (femaleDs) {
            femaleDs.borderColor = '#ec4899'; // 핑크색
            femaleDs.backgroundColor = '#ec489933';
            targetDatasets.push(femaleDs);
        }
    }
    else if (exploreType === 'gender_diff') {
        const maleDs = allDatasets.find(d => d.label.startsWith('남자') && d.label.includes(indicator));
        const femaleDs = allDatasets.find(d => d.label.startsWith('여자') && d.label.includes(indicator));
        if (maleDs && femaleDs) {
            const diffData = maleDs.data.map((val, idx) => {
                if (val === null || femaleDs.data[idx] === null) return null;
                return parseFloat((val - femaleDs.data[idx]).toFixed(2));
            });
            targetDatasets.push({
                label: formatEmpGapLabel(indicator, 'gender'),
                data: diffData,
                borderColor: '#8b5cf6', // 보라색
                backgroundColor: '#8b5cf633',
                fill: true,
                tension: 0.1,
                pointRadius: 2
            });
        } else {
            showError(document.getElementById('emp-error'), '성별 데이터가 포함되어 있지 않습니다.');
        }
    }
    else if (exploreType === 'farm') {
        const farmDs = allDatasets.find(d => d.label.startsWith('농가') && !d.label.includes('남자') && !d.label.includes('여자') && d.label.includes(indicator));
        const nonFarmDs = allDatasets.find(d => d.label.startsWith('비농가') && !d.label.includes('남자') && !d.label.includes('여자') && d.label.includes(indicator));
        if (farmDs) {
            farmDs.borderColor = '#10b981'; // 초록색
            farmDs.backgroundColor = '#10b98133';
            targetDatasets.push(farmDs);
        }
        if (nonFarmDs) {
            nonFarmDs.borderColor = '#f59e0b'; // 주황색
            nonFarmDs.backgroundColor = '#f59e0b33';
            targetDatasets.push(nonFarmDs);
        }
        if (!farmDs && !nonFarmDs) {
            showError(document.getElementById('emp-error'), '농가/비농가 데이터가 포함되어 있지 않습니다.');
        }
    }
    else if (exploreType === 'farm_diff') {
        const farmDs = allDatasets.find(d => d.label.startsWith('농가') && !d.label.includes('남자') && !d.label.includes('여자') && d.label.includes(indicator));
        const nonFarmDs = allDatasets.find(d => d.label.startsWith('비농가') && !d.label.includes('남자') && !d.label.includes('여자') && d.label.includes(indicator));
        if (farmDs && nonFarmDs) {
            const diffData = nonFarmDs.data.map((val, idx) => {
                if (val === null || farmDs.data[idx] === null) return null;
                return parseFloat((val - farmDs.data[idx]).toFixed(2));
            });
            targetDatasets.push({
                label: formatEmpGapLabel(indicator, 'farm'),
                data: diffData,
                borderColor: '#ef4444', // 빨간색
                backgroundColor: '#ef444433',
                fill: true,
                tension: 0.1,
                pointRadius: 2
            });
        } else {
            showError(document.getElementById('emp-error'), '농가/비농가 데이터가 포함되어 있지 않습니다.');
        }
    }

    // 슬라이더 범위에 맞게 데이터 자르기
    const slicedDatasets = targetDatasets.map(ds => {
        return { ...ds, data: ds.data.slice(startIdx, endIdx + 1) };
    });

    const labelSpan = document.getElementById('emp-range-label');
    labelSpan.textContent = `${slicedLabels[0]} ~ ${slicedLabels[slicedLabels.length - 1]}`;

    if (empChartInstance) empChartInstance.destroy();

    const ctx = document.getElementById('empChart').getContext('2d');
    empChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: slicedLabels,
            datasets: slicedDatasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top' },
            }
        }
    });
}

const MY_COLORS = ['#d97706', '#0284c7', '#059669', '#db2777', '#7c3aed', '#ea580c', '#0f766e', '#b45309'];
const MY_ROW_LIMIT = 3000;

let myChartInstance = null;
let myMatrix = [];
let myTransposed = false;
let myTable = { columns: [], rows: [], guessedHeader: false, truncated: false };
let myChartType = 'line';
let myDrawn = false;
let myXReversed = false;
const myLegendNames = new Map();
let myLegendTimer = 0;

function parseStrictNumber(val) {
    if (val === null || val === undefined) return null;
    let s = String(val).trim();
    if (!s || /^[-–—]+$/.test(s) || s === '...' || s === '…' || s === '*' || s === 'x' || s === 'X') return null;
    s = s.replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
    s = s.replace(/，/g, '').replace(/．/g, '.');
    s = s.replace(/,/g, '').replace(/\s/g, '').replace(/%$/, '');
    s = s.replace(/(?:명|개|원|점)$/u, '');
    if (/^\(.+\)$/.test(s)) s = `-${s.slice(1, -1)}`;
    if (!/^[-+]?\d+(\.\d+)?$/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}

function canonicalAxisLabel(value) {
    const s = String(value ?? '').replace(/\u00a0/g, ' ').trim();
    const year = s.match(/^(\d{4})(?:\.0+)?(?:\s*년)?$/);
    return year ? year[1] : s;
}

function rowsWithForwardFill(rows, colNames) {
    const last = {};
    let filled = 0;
    const next = rows.map(row => {
        const copy = { ...row };
        colNames.forEach(col => {
            if (!col) return;
            const current = String(copy[col] ?? '').trim();
            if (current) {
                last[col] = current;
                copy[col] = current;
            } else if (last[col]) {
                copy[col] = last[col];
                filled += 1;
            }
        });
        return copy;
    });
    return { rows: next, filled };
}

function isNumericColumn(rows, name) {
    let filled = 0;
    let nums = 0;
    rows.forEach(row => {
        const raw = row[name];
        if (raw === null || raw === undefined || String(raw).trim() === '') return;
        filled += 1;
        if (parseStrictNumber(raw) !== null) nums += 1;
    });
    return filled > 0 && nums / filled >= 0.7 && nums >= 1;
}

function rowLooksNumeric(cells) {
    const filled = cells.map(cell => String(cell ?? '').trim()).filter(Boolean);
    if (filled.length < 2) return false;
    const nums = filled.filter(cell => parseStrictNumber(cell) !== null).length;
    return nums / filled.length >= 0.8;
}

function uniqueColumnName(base, used) {
    let name = base || '열';
    if (!used.has(name)) {
        used.add(name);
        return name;
    }
    let n = 2;
    while (used.has(`${base || '열'} (${n})`)) n += 1;
    const next = `${base || '열'} (${n})`;
    used.add(next);
    return next;
}

function matrixToTable(matrix) {
    const cleaned = (matrix || [])
        .map(row => (Array.isArray(row) ? row : [row]).map(cell => String(cell ?? '').replace(/\u00a0/g, ' ').trim()))
        .filter(row => row.some(cell => cell !== ''));

    if (cleaned.length < 2) {
        throw new Error('표에 내용이 부족합니다. 첫 줄에는 열 이름, 다음 줄부터 데이터가 있어야 합니다.');
    }

    let header = cleaned[0];
    let body = cleaned.slice(1);
    let guessedHeader = false;
    if (rowLooksNumeric(header)) {
        guessedHeader = true;
        body = cleaned;
        header = cleaned[0].map((_, i) => `열${i + 1}`);
    }

    const usedNames = new Set();
    const columns = header.map((cell, index) => ({
        name: uniqueColumnName(cell, usedNames),
        index
    }));

    let rows = body.map(row => {
        const obj = {};
        columns.forEach(col => {
            obj[col.name] = row[col.index] ?? '';
        });
        return obj;
    }).filter(obj => columns.some(col => String(obj[col.name]).trim() !== ''));

    const used = columns.filter(col => rows.some(row => String(row[col.name]).trim() !== ''));
    if (used.length < 2) {
        throw new Error('열이 2개 이상 있어야 x축과 y축을 고를 수 있습니다.');
    }
    if (!rows.length) {
        throw new Error('데이터 행이 없습니다. 열 이름 아래에 값을 채워 주세요.');
    }

    const names = used.map(col => col.name);
    rows = rows.map(row => {
        const obj = {};
        names.forEach(name => {
            obj[name] = row[name] ?? '';
        });
        return obj;
    });

    let truncated = false;
    if (rows.length > MY_ROW_LIMIT) {
        rows = rows.slice(0, MY_ROW_LIMIT);
        truncated = true;
    }

    return { columns: names, rows, guessedHeader, truncated };
}

function transposeMatrix(matrix) {
    const width = matrix.reduce((max, row) => Math.max(max, row.length), 0);
    const out = [];
    for (let c = 0; c < width; c += 1) {
        out.push(matrix.map(row => row[c] ?? ''));
    }
    return out;
}

function countDelimiter(line, delimiter) {
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === '"') inQuotes = !inQuotes;
        else if (!inQuotes && ch === delimiter) count += 1;
    }
    return count;
}

function detectDelimiter(text) {
    const lines = text.split(/\r?\n/).filter(line => line.trim()).slice(0, 8);
    const candidates = [',', '\t', ';'];
    let best = ',';
    let bestScore = -1;
    candidates.forEach(delimiter => {
        const counts = lines.map(line => countDelimiter(line, delimiter));
        if (!counts.length || counts[0] < 1) return;
        const same = counts.every(count => count === counts[0]);
        const score = counts[0] * (same ? 5 : 1);
        if (score > bestScore) {
            bestScore = score;
            best = delimiter;
        }
    });
    return best;
}

function decodeTableText(buf) {
    const bytes = new Uint8Array(buf);
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
        return new TextDecoder('utf-16le').decode(buf).replace(/^\uFEFF/, '');
    }
    const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    let euc = null;
    try {
        euc = new TextDecoder('euc-kr').decode(buf);
    } catch (e) {
        euc = null;
    }
    if (!euc) return utf8.replace(/^\uFEFF/, '');
    const bad = text => (text.match(/\uFFFD/g) || []).length;
    const hangul = text => (text.match(/[가-힣]/g) || []).length;
    if (bad(utf8) > 0 && (hangul(euc) > hangul(utf8) || bad(euc) < bad(utf8))) {
        return euc.replace(/^\uFEFF/, '');
    }
    return utf8.replace(/^\uFEFF/, '');
}

function readArrayBuffer(file) {
    if (file.arrayBuffer) return file.arrayBuffer();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
        reader.readAsArrayBuffer(file);
    });
}

async function loadStudentMatrix(file) {
    const buf = await readArrayBuffer(file);
    const name = file.name.toLowerCase();
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        if (typeof XLSX === 'undefined') {
            throw new Error('엑셀 파일을 읽으려면 인터넷에 연결되어야 합니다. 어렵다면 CSV 파일로 저장해 올려 주세요.');
        }
        const workbook = XLSX.read(buf, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        if (!sheet) throw new Error('엑셀 파일에서 시트를 찾지 못했습니다.');
        return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    }

    const text = decodeTableText(buf);
    const delimiter = detectDelimiter(text);
    const parsed = Papa.parse(text, { header: false, skipEmptyLines: 'greedy', delimiter });
    if (!parsed.data || !parsed.data.length) {
        throw new Error('표를 읽지 못했습니다. CSV로 다시 저장해 보세요.');
    }
    return parsed.data;
}

function formatStatNumber(n) {
    const abs = Math.abs(n);
    const digits = abs >= 1000 ? 1 : abs >= 10 ? 2 : 3;
    return n.toLocaleString('ko-KR', { maximumFractionDigits: digits });
}

function pearsonR(xs, ys) {
    const pairs = [];
    for (let i = 0; i < xs.length; i += 1) {
        if (xs[i] === null || ys[i] === null || xs[i] === undefined || ys[i] === undefined) continue;
        pairs.push([xs[i], ys[i]]);
    }
    const n = pairs.length;
    if (n < 3) return null;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    pairs.forEach(([x, y]) => {
        sx += x;
        sy += y;
        sxx += x * x;
        syy += y * y;
        sxy += x * y;
    });
    const num = n * sxy - sx * sy;
    const den = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
    if (!den) return null;
    return num / den;
}

function describeCorrelation(r) {
    const abs = Math.abs(r);
    if (abs >= 0.7) {
        return r > 0
            ? '같이 커지는 직선 관계가 뚜렷합니다.'
            : '한쪽이 커지면 다른 쪽은 작아지는 관계가 뚜렷합니다.';
    }
    if (abs >= 0.4) {
        return r > 0
            ? '같이 커지는 경향이 있습니다.'
            : '반대 방향으로 움직이는 경향이 있습니다.';
    }
    return '직선으로 설명되는 관계는 약합니다.';
}

function defaultXColumn(columns, rows) {
    const byName = columns.find(name => isTimeFieldName(name));
    if (byName) return byName;
    const textCol = columns.find(name => !isNumericColumn(rows, name));
    return textCol || columns[0];
}

function renderMyPreview() {
    const wrap = document.getElementById('my-preview');
    const table = document.createElement('table');
    table.className = 'min-w-full text-sm text-left border-collapse';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    myTable.columns.forEach(name => {
        const th = document.createElement('th');
        th.className = 'border border-amber-200 bg-amber-100 px-3 py-2 whitespace-nowrap font-bold';
        th.textContent = name;
        headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    const tbody = document.createElement('tbody');
    myTable.rows.slice(0, 5).forEach(row => {
        const tr = document.createElement('tr');
        myTable.columns.forEach(name => {
            const td = document.createElement('td');
            td.className = 'border border-amber-100 px-3 py-2 whitespace-nowrap';
            td.textContent = row[name] ?? '';
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
    table.append(thead, tbody);
    wrap.replaceChildren(table);
}

function uniqueColumnValues(rows, name) {
    const seen = new Set();
    const values = [];
    rows.forEach(row => {
        const value = String(row[name] ?? '').trim();
        if (!value || seen.has(value)) return;
        seen.add(value);
        values.push(value);
    });
    return values;
}

function isGroupColumn(rows, name) {
    const values = uniqueColumnValues(rows, name);
    if (values.length < 2 || values.length > 12) return false;
    if (rows.length >= 8 && values.length > rows.length * 0.6) return false;
    return true;
}

function looksLikeCompareColumn(name) {
    return /남|여|학년|농가|비농가/.test(String(name));
}

function seriesMode() {
    return document.querySelector('input[name="my-series-mode"]:checked')?.value || 'columns';
}

function syncSeriesMode() {
    const grouped = seriesMode() === 'group';
    document.getElementById('my-columns-box')?.classList.toggle('hidden', grouped);
    document.getElementById('my-group-box')?.classList.toggle('hidden', !grouped);
    updateShapeHint();
    renderLegendFields();
}

function legendLabel(key) {
    const custom = String(myLegendNames.get(key) || '').trim();
    return custom || key;
}

function legendSourceKeys() {
    return seriesMode() === 'group' ? checkedGroupValues() : selectedYColumns();
}

function renderLegendFields() {
    const box = document.getElementById('my-legend-box');
    const list = document.getElementById('my-legend-list');
    if (!box || !list) return;
    const keys = legendSourceKeys();
    if (!keys.length) {
        box.classList.add('hidden');
        list.innerHTML = '';
        return;
    }
    box.classList.remove('hidden');
    list.innerHTML = '';
    keys.forEach(key => {
        const row = document.createElement('label');
        row.className = 'grid sm:grid-cols-[9rem_1fr] items-center gap-2';
        const name = document.createElement('span');
        name.className = 'text-sm font-semibold text-gray-600 break-all';
        name.textContent = key;
        const input = document.createElement('input');
        input.type = 'text';
        input.maxLength = 40;
        input.placeholder = '예: 서울, 남학생';
        input.value = myLegendNames.get(key) || '';
        input.className = 'w-full text-base border-2 border-amber-200 rounded-xl px-4 py-3 bg-white focus:border-amber-500 focus:outline-none';
        input.addEventListener('input', () => {
            const text = input.value.trim();
            if (text) myLegendNames.set(key, input.value);
            else myLegendNames.delete(key);
            window.clearTimeout(myLegendTimer);
            myLegendTimer = window.setTimeout(() => {
                if (!myDrawn) return;
                try {
                    drawMyChart(false);
                } catch (error) {
                    // 이름을 고치는 동안 축 오류는 그대로 둡니다.
                }
            }, 200);
        });
        row.append(name, input);
        list.appendChild(row);
    });
}

function updateShapeHint() {
    const hint = document.getElementById('my-shape-hint');
    if (!hint || !myTable.columns.length) return;
    const xName = document.getElementById('my-x').value;
    const numeric = myTable.columns.filter(name => name !== xName && isNumericColumn(myTable.rows, name));
    const textCols = myTable.columns.filter(name => name !== xName && !isNumericColumn(myTable.rows, name));
    const stackedTable = numeric.length <= 1 && textCols.length > 0;

    if (seriesMode() === 'columns' && stackedTable) {
        hint.textContent = '이 표는 맨 윗줄에 남자·여자 칸이 따로 없습니다. 왼쪽 ‘한 평면에 여러 개의 그래프를 그릴 경우’를 고르세요. 그다음 성별이나 학년이 적힌 열을 고르고, 숫자 열은 데이터를 고르면 됩니다.';
        hint.classList.remove('hidden');
        return;
    }
    if (seriesMode() === 'group') {
        hint.textContent = '순서대로 고르면 됩니다. 1) 성별·학년이 적힌 열  2) 같이 그릴 이름  3) 숫자가 적힌 열(보통 데이터)';
        hint.classList.remove('hidden');
        return;
    }
    hint.textContent = '';
    hint.classList.add('hidden');
}

function suggestSeriesMode() {
    const xName = document.getElementById('my-x').value;
    const numeric = myTable.columns.filter(name => name !== xName && isNumericColumn(myTable.rows, name));
    const textCols = myTable.columns.filter(name => name !== xName && !isNumericColumn(myTable.rows, name));
    const mode = numeric.length <= 1 && textCols.length ? 'group' : 'columns';
    const radio = document.querySelector(`input[name="my-series-mode"][value="${mode}"]`);
    if (radio) radio.checked = true;
    syncSeriesMode();
}

function renderYList(preserve) {
    const xName = document.getElementById('my-x').value;
    const previous = new Set(
        [...document.querySelectorAll('#my-y-list input:checked')].map(input => input.value)
    );
    const box = document.getElementById('my-y-list');
    box.innerHTML = '';

    myTable.columns.forEach(name => {
        if (name === xName) return;
        const numeric = isNumericColumn(myTable.rows, name);
        if (!numeric) return;
        const label = document.createElement('label');
        label.className = `flex items-center gap-3 min-h-[3.5rem] px-4 py-3 rounded-xl border-2 bg-white ${
            numeric ? 'border-amber-200 cursor-pointer' : 'border-gray-200 opacity-60 cursor-not-allowed'
        }`;
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = name;
        input.disabled = !numeric;
        input.className = 'w-6 h-6 accent-amber-600 shrink-0';
        input.checked = preserve && previous.has(name) && numeric;
        const span = document.createElement('span');
        span.className = 'text-base font-semibold text-gray-800';
        span.textContent = name;
        label.append(input, span);
        box.appendChild(label);
    });

    const inputs = [...box.querySelectorAll('input:not(:disabled)')];
    if (!inputs.length) {
        const note = document.createElement('p');
        note.className = 'text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3';
        note.textContent = '가로로 나란히 그릴 숫자 칸이 없습니다. 위의 왼쪽을 고르세요.';
        box.appendChild(note);
    }
    if (!inputs.some(input => input.checked)) {
        const compare = inputs.filter(input => looksLikeCompareColumn(input.value));
        if (!preserve && compare.length >= 2) {
            inputs.forEach(input => {
                input.checked = looksLikeCompareColumn(input.value);
            });
        } else if (!preserve && inputs.length > 0 && inputs.length <= 6) {
            inputs.forEach(input => {
                input.checked = true;
            });
        } else if (inputs[0]) {
            inputs[0].checked = true;
        }
    }
    updateShapeHint();
    renderLegendFields();
}

function renderGroupValues(preserve) {
    const box = document.getElementById('my-group-values');
    if (!box) return;
    const previous = new Set(
        [...box.querySelectorAll('input:checked')].map(input => input.value)
    );
    box.innerHTML = '';
    const column = document.getElementById('my-group').value;
    if (!column) return;

    uniqueColumnValues(myTable.rows, column).forEach((value, index) => {
        const label = document.createElement('label');
        label.className = 'flex items-center gap-3 min-h-[3.25rem] px-4 py-2 rounded-xl border-2 border-amber-200 bg-white cursor-pointer';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = value;
        input.className = 'w-6 h-6 accent-amber-600 shrink-0';
        input.checked = preserve ? previous.has(value) : index < 6;
        const span = document.createElement('span');
        span.className = 'text-base font-semibold text-gray-800';
        span.textContent = value;
        label.append(input, span);
        box.appendChild(label);
    });

    if (![...box.querySelectorAll('input')].some(input => input.checked)) {
        const first = box.querySelector('input');
        if (first) first.checked = true;
    }
    renderLegendFields();
}

function renderGroupControls(preserve) {
    const groupSelect = document.getElementById('my-group');
    const ySelect = document.getElementById('my-group-y');
    if (!groupSelect || !ySelect) return;

    const xName = document.getElementById('my-x').value;
    const prevGroup = groupSelect.value;
    const prevY = ySelect.value;
    const candidates = myTable.columns.filter(name => name !== xName && isGroupColumn(myTable.rows, name));
    const groupNames = candidates.length ? candidates : myTable.columns.filter(name => name !== xName);

    groupSelect.innerHTML = '';
    groupNames.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = `${name} (이름 ${uniqueColumnValues(myTable.rows, name).length}개)`;
        groupSelect.appendChild(option);
    });

    const ranked = [...groupNames].sort((a, b) => {
        const score = name => (isGroupColumn(myTable.rows, name) ? 2 : 0) + (/성별|학년|구분|집단|분류|항목/.test(name) ? 3 : 0);
        return score(b) - score(a);
    });
    if (preserve && groupNames.includes(prevGroup)) groupSelect.value = prevGroup;
    else if (ranked[0]) groupSelect.value = ranked[0];

    const yNames = myTable.columns.filter(name => name !== xName && name !== groupSelect.value && isNumericColumn(myTable.rows, name));
    ySelect.innerHTML = '';
    yNames.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        ySelect.appendChild(option);
    });
    if (preserve && yNames.includes(prevY)) ySelect.value = prevY;
    renderGroupValues(preserve && groupSelect.value === prevGroup);
}

function renderMyAxes() {
    const select = document.getElementById('my-x');
    const current = select.value;
    select.innerHTML = '';
    myTable.columns.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = isNumericColumn(myTable.rows, name) ? `${name} (숫자)` : name;
        select.appendChild(option);
    });
    const preferred = myTable.columns.includes(current) ? current : defaultXColumn(myTable.columns, myTable.rows);
    select.value = preferred;
    renderYList(false);
    renderGroupControls(false);
    suggestSeriesMode();
}

function selectedYColumns() {
    const xName = document.getElementById('my-x').value;
    return [...document.querySelectorAll('#my-y-list input:checked')]
        .map(input => input.value)
        .filter(name => name && name !== xName);
}

function showMyWarnings() {
    const warn = document.getElementById('my-warn');
    const notes = [];
    if (myTable.guessedHeader) {
        notes.push('첫 줄이 숫자라서 열 이름을 열1, 열2…로 붙였습니다. 가능하면 첫 줄에 연도, 고용률 같은 이름을 넣어 주세요.');
    }
    if (myTable.truncated) {
        notes.push(`행이 많아 앞 ${MY_ROW_LIMIT.toLocaleString('ko-KR')}행만 그립니다.`);
    }
    if (myTransposed) notes.push('행과 열을 바꾼 표로 보고 있습니다.');
    if (!notes.length) {
        warn.classList.add('hidden');
        warn.textContent = '';
        return;
    }
    warn.textContent = notes.join(' ');
    warn.classList.remove('hidden');
}

function applyMyMatrix() {
    const matrix = myTransposed ? transposeMatrix(myMatrix) : myMatrix;
    myTable = matrixToTable(matrix);
    myLegendNames.clear();
    myXReversed = false;
    syncXReverseButtons();
    myDrawn = false;
    document.getElementById('my-preview-wrap').classList.remove('hidden');
    document.getElementById('my-setup').classList.remove('hidden');
    document.getElementById('my-capture-area').classList.add('hidden');
    if (myChartInstance) {
        myChartInstance.destroy();
        myChartInstance = null;
    }
    renderMyPreview();
    renderMyAxes();
    showMyWarnings();
}

function checkedGroupValues() {
    return [...document.querySelectorAll('#my-group-values input:checked')].map(input => input.value);
}

function buildFullSeries() {
    const xCol = document.getElementById('my-x').value;
    if (!xCol) throw new Error('x축으로 쓸 열을 골라 주세요.');

    if (seriesMode() === 'group') {
        const groupCol = document.getElementById('my-group').value;
        const yCol = document.getElementById('my-group-y').value;
        const groups = checkedGroupValues();
        if (!groupCol) throw new Error('줄을 나눌 열을 골라 주세요. 성별이나 학년 열이 있으면 그 열을 고르세요.');
        if (!yCol) throw new Error('값으로 쓸 숫자 열을 골라 주세요.');
        if (yCol === xCol || yCol === groupCol) throw new Error('x축, 구분 열, 값 열은 서로 달라야 합니다.');
        if (!groups.length) throw new Error('같은 평면에 그릴 구분을 하나 이상 골라 주세요.');
        if (groups.length > 8) throw new Error('한 번에 8개 줄까지만 그릴 수 있습니다. 비교할 구분만 남겨 주세요.');

        const filledRows = rowsWithForwardFill(myTable.rows, [xCol, groupCol]);
        const seen = new Set();
        const labels = [];
        filledRows.rows.forEach(row => {
            const x = canonicalAxisLabel(row[xCol]);
            if (!x || seen.has(x)) return;
            seen.add(x);
            labels.push(x);
        });
        if (!labels.length) throw new Error('x축으로 쓸 값이 없습니다.');
        if (labels.every(label => /^\d{4}/.test(label))) labels.sort((a, b) => a.localeCompare(b, 'ko'));

        const series = groups.map(group => {
            const byX = new Map();
            filledRows.rows.forEach(row => {
                if (String(row[groupCol] ?? '').trim() !== group) return;
                const x = canonicalAxisLabel(row[xCol]);
                const y = parseStrictNumber(row[yCol]);
                if (!x || y === null) return;
                if (!byX.has(x)) byX.set(x, y);
            });
            return { label: legendLabel(group), values: labels.map(x => (byX.has(x) ? byX.get(x) : null)) };
        });
        return { xCol, yTitle: yCol, labels, series, filledBlanks: filledRows.filled };
    }

    const yCols = selectedYColumns();
    if (!yCols.length) throw new Error('비교할 숫자 열을 하나 이상 골라 주세요. 남자·여자나 학년 열을 여러 개 누를 수 있습니다.');
    if (yCols.length > 8) throw new Error('한 번에 8개 줄까지만 그릴 수 있습니다. 비교할 열만 남겨 주세요.');
    return {
        xCol,
        yTitle: yCols.length === 1 ? yCols[0] : '값',
        labels: myTable.rows.map(row => String(row[xCol] ?? '')),
        series: yCols.map(yCol => ({
            label: legendLabel(yCol),
            values: myTable.rows.map(row => parseStrictNumber(row[yCol]))
        })),
        filledBlanks: 0
    };
}

function fillMyStats(labels, series) {
    const box = document.getElementById('my-stats');
    box.innerHTML = '';
    const head = document.createElement('p');
    head.className = 'font-bold text-amber-950';
    head.textContent = `표시 구간: ${labels[0]} ~ ${labels[labels.length - 1]} · 같은 평면에 ${series.length}개 줄`;
    box.appendChild(head);

    const list = document.createElement('ul');
    list.className = 'mt-2 space-y-1';
    series.forEach(item => {
        const values = item.values.filter(value => value !== null);
        const li = document.createElement('li');
        if (!values.length) {
            li.textContent = `${item.label}: 숫자가 없습니다.`;
        } else {
            const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
            li.textContent = `${item.label}: 평균 ${formatStatNumber(mean)} · 최솟값 ${formatStatNumber(Math.min(...values))} · 최댓값 ${formatStatNumber(Math.max(...values))}`;
        }
        list.appendChild(li);
    });
    box.appendChild(list);

    if (series.length === 2) {
        let gap = null;
        let at = '';
        for (let i = labels.length - 1; i >= 0; i -= 1) {
            const a = series[0].values[i];
            const b = series[1].values[i];
            if (a === null || b === null) continue;
            gap = a - b;
            at = labels[i];
            break;
        }
        if (gap !== null) {
            const diff = document.createElement('p');
            diff.className = 'mt-3 text-amber-950';
            diff.textContent = `${at} 차이: ${series[0].label} − ${series[1].label} = ${formatStatNumber(gap)}`;
            box.appendChild(diff);
        }
    }

    const numericSeries = series.filter(item => item.values.some(value => value !== null));
    if (numericSeries.length >= 2) {
        const peaks = numericSeries.map(item => Math.max(...item.values.filter(value => value !== null)));
        const largest = Math.max(...peaks);
        const smallest = Math.min(...peaks);
        if (smallest > 0 && largest / smallest >= 5) {
            const scaleNote = document.createElement('p');
            scaleNote.className = 'mt-3 text-amber-950 leading-relaxed';
            scaleNote.textContent = '값 차이가 커서 작은 줄이 아래쪽에 붙을 수 있습니다. 소계처럼 큰 구분은 체크를 끄면 학년·집단 차이가 더 잘 보입니다.';
            box.appendChild(scaleNote);
        }
    }

    if (series.length === 1 && labels.every(label => parseStrictNumber(label) !== null)) {
        const r = pearsonR(
            labels.map(label => parseStrictNumber(label)),
            series[0].values
        );
        if (r !== null) {
            const note = document.createElement('p');
            note.className = 'mt-3 text-amber-950 leading-relaxed';
            note.textContent = `상관계수 r = ${r.toFixed(2)}. ${describeCorrelation(r)} 상관계수는 두 값이 같이 움직이는 정도만 보여 주며, 어느 쪽이 원인인지는 말해 주지 않습니다.`;
            box.appendChild(note);
        }
    }
}

function drawMyChart(resetSlider) {
    const errorDiv = document.getElementById('my-error');
    const full = buildFullSeries();
    if (myChartType === 'scatter' && !full.labels.every(label => parseStrictNumber(label) !== null)) {
        throw new Error('산점도는 x축도 숫자여야 합니다. 연도나 이름이면 꺾은선이나 막대를 고르세요.');
    }
    if (!full.labels.length) throw new Error('보여줄 값이 없습니다.');
    if (myXReversed && myChartType !== 'scatter') {
        full.labels.reverse();
        full.series.forEach(item => item.values.reverse());
    }

    const total = full.labels.length;
    const startSlider = document.getElementById('my-slider-start');
    const endSlider = document.getElementById('my-slider-end');
    if (resetSlider) {
        startSlider.max = String(total - 1);
        endSlider.max = String(total - 1);
        startSlider.value = '0';
        endSlider.value = String(total - 1);
    } else {
        startSlider.max = String(total - 1);
        endSlider.max = String(total - 1);
    }
    let startIdx = parseInt(startSlider.value, 10) || 0;
    let endIdx = parseInt(endSlider.value, 10) || 0;
    startIdx = Math.max(0, Math.min(startIdx, total - 1));
    endIdx = Math.max(0, Math.min(endIdx, total - 1));
    if (startIdx > endIdx) {
        const temp = startIdx;
        startIdx = endIdx;
        endIdx = temp;
    }

    const labels = full.labels.slice(startIdx, endIdx + 1);
    const series = full.series.map(item => ({
        label: item.label,
        values: item.values.slice(startIdx, endIdx + 1)
    }));
    const plotSeries = series.filter(item => item.values.some(value => value !== null));
    if (!plotSeries.length) throw new Error('선택한 줄에서 숫자를 찾지 못했습니다. 값으로 쓸 열이 숫자인지 확인해 주세요.');

    const titleInput = document.getElementById('my-title').value.trim();
    const chartTitle = titleInput || plotSeries.map(item => item.label).join(', ');
    document.getElementById('my-chart-heading').textContent = chartTitle;
    document.getElementById('my-range-label').textContent = `${labels[0]} ~ ${labels[labels.length - 1]}`;

    const datasets = plotSeries.map((item, index) => {
        const color = MY_COLORS[index % MY_COLORS.length];
        if (myChartType === 'scatter') {
            return {
                label: item.label,
                data: labels.map((label, i) => ({
                    x: parseStrictNumber(label),
                    y: item.values[i]
                })).filter(point => point.x !== null && point.y !== null),
                borderColor: color,
                backgroundColor: color,
                pointRadius: 6,
                pointHitRadius: 16,
                showLine: false
            };
        }
        return {
            label: item.label,
            data: item.values,
            borderColor: color,
            backgroundColor: myChartType === 'bar' ? color : `${color}33`,
            pointRadius: myChartType === 'bar' ? 0 : 4,
            pointHitRadius: 14,
            borderWidth: 2.5,
            tension: 0.15,
            spanGaps: true,
            fill: false
        };
    });

    if (myChartType === 'scatter' && datasets.every(ds => ds.data.length === 0)) {
        throw new Error('산점도로 그릴 숫자 쌍이 없습니다. x축과 y축이 모두 숫자인지 확인해 주세요.');
    }

    document.getElementById('my-capture-area').classList.remove('hidden');
    if (myChartInstance) myChartInstance.destroy();
    const ctx = document.getElementById('myChart').getContext('2d');
    myChartInstance = new Chart(ctx, {
        type: myChartType === 'scatter' ? 'scatter' : myChartType,
        data: {
            labels: myChartType === 'scatter' ? undefined : labels,
            datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            layout: { padding: { left: 8, right: 8, top: 4, bottom: 4 } },
            interaction: { mode: 'nearest', intersect: false },
            plugins: {
                legend: {
                    position: 'top',
                    labels: { boxWidth: 18, padding: 16, font: { size: 14 } }
                },
                title: {
                    display: true,
                    text: chartTitle,
                    font: { size: 18, weight: 'bold' },
                    color: '#78350f',
                    padding: { bottom: 12 }
                },
                tooltip: {
                    callbacks: {
                        label(context) {
                            if (myChartType === 'scatter') {
                                const x = context.parsed.x;
                                const y = context.parsed.y;
                                return `${context.dataset.label}: (${formatStatNumber(x)}, ${formatStatNumber(y)})`;
                            }
                            const y = context.parsed.y;
                            return `${context.dataset.label}: ${y === null || Number.isNaN(y) ? '값 없음' : formatStatNumber(y)}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: myChartType === 'scatter' ? 'linear' : 'category',
                    reverse: myChartType === 'scatter' && myXReversed,
                    title: { display: true, text: full.xCol, font: { size: 14, weight: 'bold' } },
                    ticks: { maxRotation: 40, autoSkip: true, font: { size: 12 } }
                },
                y: {
                    title: {
                        display: true,
                        text: full.yTitle,
                        font: { size: 14, weight: 'bold' }
                    },
                    ticks: { font: { size: 12 } }
                }
            }
        }
    });

    fillMyStats(labels, series);
    if (full.filledBlanks > 0) {
        const note = document.createElement('p');
        note.className = 'mt-3 text-amber-950 leading-relaxed';
        note.textContent = '비어 있는 시점·구분 칸은 바로 위 칸과 같은 값으로 이어서 그렸습니다. 통계표에서 연도나 학년이 한 번만 적힌 경우입니다.';
        document.getElementById('my-stats').appendChild(note);
    }
    errorDiv.classList.add('hidden');
    requestAnimationFrame(() => {
        if (myChartInstance) myChartInstance.resize();
    });
}

function syncXReverseButtons() {
    document.querySelectorAll('.my-x-reverse-btn').forEach(btn => {
        btn.setAttribute('aria-pressed', myXReversed ? 'true' : 'false');
        btn.classList.toggle('bg-pink-300', myXReversed);
        btn.classList.toggle('border-pink-400', myXReversed);
        btn.classList.toggle('bg-pink-100', !myXReversed);
        btn.classList.toggle('border-pink-200', !myXReversed);
        const label = btn.querySelector('span');
        if (label) label.textContent = myXReversed ? 'x축 원래 순서로' : 'x축 반대로 정렬';
    });
}

function clearMyData() {
    myMatrix = [];
    myTransposed = false;
    myTable = { columns: [], rows: [], guessedHeader: false, truncated: false };
    myLegendNames.clear();
    myXReversed = false;
    syncXReverseButtons();
    myDrawn = false;
    myChartType = 'line';
    if (myChartInstance) {
        myChartInstance.destroy();
        myChartInstance = null;
    }
    const fileInput = document.getElementById('my-file');
    if (fileInput) fileInput.value = '';
    document.getElementById('my-file-note').classList.add('hidden');
    document.getElementById('my-preview-wrap').classList.add('hidden');
    document.getElementById('my-setup').classList.add('hidden');
    document.getElementById('my-capture-area').classList.add('hidden');
    document.getElementById('my-error').classList.add('hidden');
    document.getElementById('my-warn').classList.add('hidden');
    document.getElementById('my-title').value = '';
    const columnsMode = document.querySelector('input[name="my-series-mode"][value="columns"]');
    if (columnsMode) columnsMode.checked = true;
    syncSeriesMode();
    document.querySelectorAll('.my-type-btn').forEach(btn => {
        const on = btn.dataset.type === 'line';
        btn.classList.toggle('bg-amber-500', on);
        btn.classList.toggle('text-white', on);
        btn.classList.toggle('border-amber-500', on);
        btn.classList.toggle('bg-white', !on);
        btn.classList.toggle('text-amber-950', !on);
        btn.classList.toggle('border-amber-200', !on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
}

function setupMyDataExplorer() {
    const fileInput = document.getElementById('my-file');
    const errorDiv = document.getElementById('my-error');
    if (!fileInput) return;

    fileInput.addEventListener('change', async () => {
        const file = fileInput.files && fileInput.files[0];
        errorDiv.classList.add('hidden');
        if (!file) return;
        try {
            myMatrix = await loadStudentMatrix(file);
            myTransposed = false;
            applyMyMatrix();
            document.getElementById('my-file-label').textContent = `${file.name} · ${myTable.rows.length.toLocaleString('ko-KR')}행 · ${myTable.columns.length}열`;
            document.getElementById('my-file-note').classList.remove('hidden');
            document.getElementById('my-setup').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } catch (e) {
            clearMyData();
            showError(errorDiv, e.message || '파일을 읽지 못했습니다.');
        }
    });

    document.getElementById('my-clear-btn').addEventListener('click', clearMyData);

    document.getElementById('my-transpose-btn').addEventListener('click', () => {
        if (!myMatrix.length) return;
        myTransposed = !myTransposed;
        try {
            applyMyMatrix();
            const label = document.getElementById('my-file-label');
            const fileName = label.textContent.split(' · ')[0];
            label.textContent = `${fileName} · ${myTable.rows.length.toLocaleString('ko-KR')}행 · ${myTable.columns.length}열`;
        } catch (e) {
            myTransposed = !myTransposed;
            showError(errorDiv, e.message || '행과 열을 바꾸지 못했습니다.');
        }
    });

    document.getElementById('my-x').addEventListener('change', () => {
        renderYList(true);
        renderGroupControls(true);
        if (!myDrawn) return;
        try {
            drawMyChart(true);
        } catch (e) {
            showError(errorDiv, e.message);
        }
    });

    document.querySelectorAll('input[name="my-series-mode"]').forEach(radio => {
        radio.addEventListener('change', () => {
            syncSeriesMode();
            if (!myDrawn) return;
            try {
                drawMyChart(true);
            } catch (e) {
                showError(errorDiv, e.message);
            }
        });
    });

    document.getElementById('my-y-all').addEventListener('click', () => {
        [...document.querySelectorAll('#my-y-list input:not(:disabled)')].forEach((input, index) => {
            input.checked = index < 8;
        });
        renderLegendFields();
        if (!myDrawn) return;
        try {
            drawMyChart(false);
        } catch (e) {
            showError(errorDiv, e.message);
        }
    });

    document.getElementById('my-y-one').addEventListener('click', () => {
        const inputs = [...document.querySelectorAll('#my-y-list input')];
        let kept = false;
        inputs.forEach(input => {
            input.checked = !kept && !input.disabled;
            if (input.checked) kept = true;
        });
        renderLegendFields();
        if (!myDrawn) return;
        try {
            drawMyChart(false);
        } catch (e) {
            showError(errorDiv, e.message);
        }
    });

    document.getElementById('my-group').addEventListener('change', () => {
        const ySelect = document.getElementById('my-group-y');
        const prevY = ySelect.value;
        const xName = document.getElementById('my-x').value;
        const groupName = document.getElementById('my-group').value;
        const yNames = myTable.columns.filter(name => name !== xName && name !== groupName && isNumericColumn(myTable.rows, name));
        ySelect.innerHTML = '';
        yNames.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            ySelect.appendChild(option);
        });
        if (yNames.includes(prevY)) ySelect.value = prevY;
        renderGroupValues(false);
        if (!myDrawn) return;
        try {
            drawMyChart(true);
        } catch (e) {
            showError(errorDiv, e.message);
        }
    });

    document.getElementById('my-group-y').addEventListener('change', () => {
        if (!myDrawn) return;
        try {
            drawMyChart(false);
        } catch (e) {
            showError(errorDiv, e.message);
        }
    });

    document.getElementById('my-group-values').addEventListener('change', () => {
        renderLegendFields();
        if (!myDrawn) return;
        try {
            drawMyChart(false);
        } catch (e) {
            showError(errorDiv, e.message);
        }
    });

    document.getElementById('my-y-list').addEventListener('change', () => {
        renderLegendFields();
        if (!myDrawn) return;
        try {
            drawMyChart(false);
        } catch (e) {
            showError(errorDiv, e.message);
        }
    });

    document.querySelectorAll('.my-type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            myChartType = btn.dataset.type;
            document.querySelectorAll('.my-type-btn').forEach(other => {
                const on = other === btn;
                other.classList.toggle('bg-amber-500', on);
                other.classList.toggle('text-white', on);
                other.classList.toggle('border-amber-500', on);
                other.classList.toggle('bg-white', !on);
                other.classList.toggle('text-amber-950', !on);
                other.classList.toggle('border-amber-200', !on);
                other.setAttribute('aria-pressed', on ? 'true' : 'false');
            });
            if (!myDrawn) return;
            try {
                drawMyChart(false);
            } catch (e) {
                showError(errorDiv, e.message);
            }
        });
    });

    document.getElementById('my-draw-btn').addEventListener('click', () => {
        errorDiv.classList.add('hidden');
        if (!myTable.rows.length) {
            showError(errorDiv, '먼저 표 파일을 올려 주세요.');
            return;
        }
        try {
            drawMyChart(true);
            myDrawn = true;
            revealChartPanel('my-capture-area');
        } catch (e) {
            showError(errorDiv, e.message);
        }
    });

    document.getElementById('my-copy-btn').addEventListener('click', () => {
        copyMyChartImage();
    });

    document.querySelectorAll('.my-x-reverse-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            myXReversed = !myXReversed;
            syncXReverseButtons();
            if (!myDrawn) return;
            try {
                drawMyChart(true);
            } catch (e) {
                showError(errorDiv, e.message);
            }
        });
    });

    document.getElementById('my-slider-start').addEventListener('input', () => {
        if (!myDrawn) return;
        try {
            drawMyChart(false);
        } catch (e) {
            showError(errorDiv, e.message);
        }
    });
    document.getElementById('my-slider-end').addEventListener('input', () => {
        if (!myDrawn) return;
        try {
            drawMyChart(false);
        } catch (e) {
            showError(errorDiv, e.message);
        }
    });
}

function savedAtLabel(date = new Date()) {
    const pad = value => String(value).padStart(2, '0');
    return `저장 일시: ${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function chartPngBlob(source, caption) {
    const pad = 24;
    const captionHeight = caption ? Math.max(56, Math.round(source.width * 0.05)) : 0;
    const canvas = document.createElement('canvas');
    canvas.width = source.width + pad * 2;
    canvas.height = source.height + pad * 2 + captionHeight;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, pad, pad);
    if (caption) {
        ctx.fillStyle = '#374151';
        ctx.font = `700 ${Math.max(22, Math.round(captionHeight * 0.38))}px "Malgun Gothic", sans-serif`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(caption, canvas.width - pad, source.height + pad + captionHeight / 2);
    }
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

async function copyMyChartImage() {
    const note = document.getElementById('my-copy-note');
    const source = document.getElementById('myChart');
    const showNote = (text) => {
        if (!note) return;
        note.textContent = text;
        note.classList.remove('hidden');
    };
    if (!myDrawn || !source || !source.width) {
        showNote('먼저 그래프 그리기를 눌러 주세요.');
        return;
    }

    const blobPromise = chartPngBlob(source);
    if (navigator.clipboard && window.ClipboardItem) {
        try {
            await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': blobPromise })
            ]);
        } catch (error) {
            // 브라우저가 클립보드를 막으면, 포스터 칸의 붙여넣기에서 방금 복사한 이미지를 사용합니다.
        }
    }

    const blob = await blobPromise;
    if (!blob) {
        showNote('이미지를 복사하지 못했습니다. 다시 눌러 주세요.');
        return;
    }
    window.__ecomathCopiedChart = new File([blob], '그래프.png', { type: 'image/png' });
    showNote('복사했습니다. 포스터의 이미지 칸을 누르고 Ctrl+V로 붙여 넣으세요.');
}

async function saveMyChartImage() {
    const source = document.getElementById('myChart');
    if (!myDrawn || !source || !source.width) {
        alert('먼저 그래프 그리기를 눌러 주세요.');
        return;
    }
    const blob = await chartPngBlob(source, savedAtLabel());
    if (!blob) {
        alert('그래프를 저장하지 못했습니다. 다시 눌러 주세요.');
        return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = '그래프.png';
    link.href = url;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setupNavigation() {
    const mobileToggle = document.getElementById('nav-mobile-toggle');
    const mobileMenu = document.getElementById('nav-mobile-menu');

    mobileToggle?.addEventListener('click', () => {
        mobileMenu.classList.toggle('hidden');
    });

    document.querySelectorAll('#main-nav a, #main-nav button.nav-link, #bottom-nav a, #bottom-nav button').forEach(link => {
        link.addEventListener('click', () => mobileMenu?.classList.add('hidden'));
    });

    const sections = ['intro', 'cpi', 'employment', 'quiz', 'mydata', 'poster'].map(id => ({
        id,
        el: document.getElementById(id)
    })).filter(s => s.el);

    const updateActiveNav = () => {
        let current = sections[0].id;
        const scrollY = window.scrollY + 180;

        for (const section of sections) {
            if (section.el.offsetTop <= scrollY) current = section.id;
        }

        document.querySelectorAll('.nav-link, .bottom-nav-link').forEach(link => {
            if (link.dataset.section === 'chatbot') return;
            link.classList.toggle('active', link.dataset.section === current);
        });
    };

    window.addEventListener('scroll', updateActiveNav, { passive: true });
    updateActiveNav();
}

document.addEventListener('DOMContentLoaded', () => {
    setupNavigation();
    initUsageVideo();
    setupMyDataExplorer();

    // CPI 슬라이더 이벤트
    document.getElementById('cpi-slider-start').addEventListener('input', updateCpiChart);
    document.getElementById('cpi-slider-end').addEventListener('input', updateCpiChart);

    // 고용 슬라이더 이벤트
    document.getElementById('emp-slider-start').addEventListener('input', updateEmpChart);
    document.getElementById('emp-slider-end').addEventListener('input', updateEmpChart);
    
    // 고용 분석 조건 이벤트
    document.getElementById('emp-indicator-select').addEventListener('change', updateEmpChart);
    document.querySelectorAll('input[name="emp-explore-radio"]').forEach(radio => {
        radio.addEventListener('change', updateEmpChart);
    });

    // CPI 데이터 초기화(삭제) 버튼
    document.getElementById('cpi-clear-btn').addEventListener('click', () => {
        document.getElementById('cpi-file').value = '';
        if (cpiChartInstance) cpiChartInstance.destroy();
        document.getElementById('cpi-placeholder').classList.remove('hidden');
        document.getElementById('cpi-capture-area').classList.add('hidden');
        document.getElementById('cpi-slider-container').classList.add('hidden');
        document.getElementById('cpi-filter-container').classList.add('hidden');
        document.getElementById('cpi-clear-btn').classList.add('hidden');
        document.getElementById('cpi-error').classList.add('hidden');
        cpiGlobalData = { labels: [], datasets: [] };
    });

    // 고용 지표 데이터 초기화(삭제) 버튼
    document.getElementById('emp-clear-btn').addEventListener('click', () => {
        document.getElementById('emp-file').value = '';
        if (empChartInstance) empChartInstance.destroy();
        document.getElementById('emp-placeholder').classList.remove('hidden');
        document.getElementById('emp-capture-area').classList.add('hidden');
        document.getElementById('emp-slider-container').classList.add('hidden');
        document.getElementById('emp-filter-container').classList.add('hidden');
        document.getElementById('emp-clear-btn').classList.add('hidden');
        document.getElementById('emp-error').classList.add('hidden');
        empGlobalData = { labels: [], datasets: [] };
        // 분석 조건 UI 초기화 (옵션)
        document.getElementById('emp-indicator-select').value = '경제활동참가율';
        document.querySelector('input[name="emp-explore-radio"][value="all"]').checked = true;
    });

    // CPI 차트 그리기 버튼
    document.getElementById('cpi-process-btn').addEventListener('click', () => {
        const fileInput = document.getElementById('cpi-file');
        const errorDiv = document.getElementById('cpi-error');
        errorDiv.classList.add('hidden');

        if (!fileInput.files || fileInput.files.length === 0) {
            showError(errorDiv, 'CSV 파일을 선택해주세요.');
            return;
        }
        
        Papa.parse(fileInput.files[0], {
            header: true,
            skipEmptyLines: true,
            encoding: "EUC-KR",
            complete: function(results) {
                try {
                    const data = results.data;
                    const meta = results.meta;
                    if(data.length === 0) throw new Error("데이터가 없습니다.");
                    
                    // 파싱 로직 호출 (#10b981 : emerald-500)
                    const parsed = parseKosisData(data, meta, '#10b981');
                    parsed.datasets = normalizeCpiDatasets(parsed.datasets);
                    cpiGlobalData = parsed;

                    // 슬라이더 초기화
                    const maxIdx = parsed.labels.length - 1;
                    const startSlider = document.getElementById('cpi-slider-start');
                    const endSlider = document.getElementById('cpi-slider-end');
                    
                    startSlider.max = maxIdx;
                    startSlider.value = 0;
                    endSlider.max = maxIdx;
                    endSlider.value = maxIdx;

                    // 체크박스 필터 렌더링
                    renderFilterCheckboxes('cpi-filter-checkboxes', parsed.datasets, updateCpiChart, 'emerald');

                    document.getElementById('cpi-placeholder').classList.add('hidden');
                    document.getElementById('cpi-slider-container').classList.remove('hidden');
                    document.getElementById('cpi-filter-container').classList.remove('hidden');
                    document.getElementById('cpi-clear-btn').classList.remove('hidden'); // 추가: 삭제 버튼 표시
                    revealChartPanel('cpi-capture-area');
                    
                    // 차트 렌더링
                    updateCpiChart();

                } catch(e) {
                    showError(errorDiv, "데이터를 파싱할 수 없습니다. " + e.message);
                }
            }
        });
    });

    // 고용 차트 그리기 버튼
    document.getElementById('emp-process-btn').addEventListener('click', () => {
        const fileInput = document.getElementById('emp-file');
        const errorDiv = document.getElementById('emp-error');
        errorDiv.classList.add('hidden');

        if (!fileInput.files || fileInput.files.length === 0) {
            showError(errorDiv, 'CSV 파일을 선택해주세요.');
            return;
        }
        
        Papa.parse(fileInput.files[0], {
            header: true,
            skipEmptyLines: true,
            encoding: "EUC-KR",
            complete: function(results) {
                try {
                    const data = results.data;
                    const meta = results.meta;
                    if(data.length === 0) throw new Error("데이터가 없습니다.");
                    
                    // 파싱 로직 호출 (#3b82f6 : blue-500)
                    const parsed = parseKosisData(data, meta, '#3b82f6');
                    empGlobalData = parsed;

                    // 슬라이더 초기화
                    const maxIdx = parsed.labels.length - 1;
                    const startSlider = document.getElementById('emp-slider-start');
                    const endSlider = document.getElementById('emp-slider-end');
                    
                    startSlider.max = maxIdx;
                    startSlider.value = 0;
                    endSlider.max = maxIdx;
                    endSlider.value = maxIdx;

                    document.getElementById('emp-placeholder').classList.add('hidden');
                    document.getElementById('emp-slider-container').classList.remove('hidden');
                    document.getElementById('emp-filter-container').classList.remove('hidden');
                    document.getElementById('emp-clear-btn').classList.remove('hidden'); // 추가: 삭제 버튼 표시
                    revealChartPanel('emp-capture-area');
                    
                    // 차트 렌더링
                    updateEmpChart();

                } catch(e) {
                    showError(errorDiv, "데이터를 파싱할 수 없습니다. " + e.message);
                }
            }
        });
    });

    // 퀴즈 채점 기능
    document.getElementById('quiz-submit-btn').addEventListener('click', () => {
        let score = 0;
        const totalQuestions = 12;
        let wrongQuestions = [];
        
        // 문제 확인 함수
        const checkQuestion = (qName, qNumber, feedbackText) => {
            const allRadios = document.querySelectorAll(`input[name="${qName}"]`);
            if (!allRadios.length) return;
            const parentQuizItem = allRadios[0].closest('.quiz-item');
            
            // 기존 피드백 요소 찾기 또는 생성
            let feedbackDiv = parentQuizItem.querySelector('.quiz-feedback');
            if (!feedbackDiv) {
                feedbackDiv = document.createElement('div');
                feedbackDiv.className = 'quiz-feedback mt-4 p-4 rounded-lg text-sm font-bold hidden';
                parentQuizItem.appendChild(feedbackDiv);
            }

            const q = document.querySelector(`input[name="${qName}"]:checked`);
            
            // 클래스 초기화
            feedbackDiv.classList.remove('hidden', 'bg-emerald-100', 'text-emerald-700', 'bg-red-100', 'text-red-700', 'bg-gray-100', 'text-gray-700');

            if (q) {
                parentQuizItem.querySelectorAll('label').forEach(lbl => {
                    const inp = lbl.querySelector('input[type="radio"]');
                    if (!inp) return;
                    lbl.classList.remove('correct-answer', 'wrong-answer');
                    if (inp.value === 'correct') lbl.classList.add('correct-answer');
                    else if (inp.checked) lbl.classList.add('wrong-answer');
                });
                
                if (q.value === 'correct') {
                    score++;
                    feedbackDiv.classList.add('bg-emerald-100', 'text-emerald-700');
                    feedbackDiv.innerHTML = `✅ 정답입니다! <div class="font-normal mt-1 text-emerald-800">${feedbackText}</div>`;
                } else {
                    wrongQuestions.push(`${qNumber}번`);
                    feedbackDiv.classList.add('bg-red-100', 'text-red-700');
                    feedbackDiv.innerHTML = `❌ 틀렸습니다. <div class="font-normal mt-1 text-red-800"><strong>해설:</strong> ${feedbackText}</div>`;
                }
            } else {
                wrongQuestions.push(`${qNumber}번`);
                feedbackDiv.classList.add('bg-gray-200', 'text-gray-700');
                feedbackDiv.innerHTML = `⚠️ 문제를 풀지 않았습니다. <div class="font-normal mt-1 text-gray-800"><strong>해설:</strong> ${feedbackText}</div>`;
            }
        };

        checkQuestion('q1', 1, '소비자물가지수(CPI)는 가구가 소비생활을 유지하기 위해 구입하는 상품과 서비스의 가격 변동을 측정한 것입니다.');
        checkQuestion('q2', 2, '실업률은 (실업자 수 ÷ 경제활동인구) × 100 입니다.');
        checkQuestion('q3', 3, '인플레이션이 발생하면 화폐 가치가 떨어지므로 갚을 돈의 가치도 떨어져 채무자에게 유리해집니다.');
        checkQuestion('q4_1', '4-1', '2018년 지수를 기준 연도(2020년) 지수로 나누면 99.1 / 100.0 = 0.991배입니다.');
        checkQuestion('q4_2', '4-2', '2022년 지수를 기준 연도(2020년) 지수로 나누면 107.7 / 100.0 = 1.077배입니다.');
        checkQuestion('q5_1', '5-1', '3월의 실업률 분모는 경제활동인구(100명), 참가율과 고용률 분모는 15세 이상 인구(120명)입니다.');
        checkQuestion('q5_2', '5-2', '4월의 실업률 분모는 경제활동인구(90명)입니다.');
        checkQuestion('q5_3', '5-3', '4월의 고용률 분모는 15세 이상 인구(120명), 분자는 취업자 수(60명)입니다.');
        checkQuestion('q6', 6, '구직 단념자는 일할 능력은 있으나 의사가 없어진 상태이므로 비경제활동인구에 속합니다.');
        checkQuestion('q7', 7, '고용 지표를 계산할 때 노동 가능 인구는 "15세 이상 인구"를 기준으로 합니다.');
        checkQuestion('q8', 8, '실업률만 분모가 "경제활동인구"이고, 참가율과 고용률의 분모는 "15세 이상 인구"입니다.');
        checkQuestion('q9', 9, '실업자가 구직을 단념하면 경제활동인구(분모)와 실업자(분자)가 같이 줄어 실업률은 하락하지만, 취업자 수는 변함이 없어 고용률은 변함없습니다.');
        checkQuestion('q10', 10, '경제활동인구는 15세 이상 인구 중에서 일할 능력과 의사가 모두 있는 취업자와 실업자를 합한 것입니다.');

        // 결과 및 피드백 표시
        const resultDiv = document.getElementById('quiz-result');
        resultDiv.classList.remove('hidden');
        
        const finalScore = (score / totalQuestions) * 100;
        
        // 소수점 처리 (예: 91.666... -> 91.7)
        const displayScore = Number.isInteger(finalScore) ? finalScore : finalScore.toFixed(1);
        
        // 등급 판정 로직
        let gradeMessage = '';
        let gradeColor = '';
        if (score >= 8) {
            gradeMessage = '🏆 경제지표 해석 우수';
            gradeColor = 'text-emerald-600';
        } else if (score >= 5) {
            gradeMessage = '📚 공식과 개념 확인';
            gradeColor = 'text-blue-600';
        } else {
            gradeMessage = '💡 개념 복습 필요';
            gradeColor = 'text-red-600';
        }
        
        if (score === totalQuestions) {
            resultDiv.innerHTML = `<div class="mb-2">🎉 대단해요! ${displayScore}점 만점입니다! 💯</div>
                                   <div class="mb-4 text-2xl font-black ${gradeColor}">${gradeMessage}</div>
                                   <div class="text-sm font-normal text-emerald-700">모든 문제의 해설을 위에서 확인할 수 있습니다.</div>`;
            resultDiv.className = "mt-6 text-xl font-bold text-emerald-600 bg-emerald-50 p-6 rounded-xl text-center";
        } else {
            let feedbackHTML = `<div class="mb-2 text-purple-700">📝 ${displayScore}점 입니다.</div>
                                <div class="mb-4 text-2xl font-black ${gradeColor}">${gradeMessage}</div>`;
            feedbackHTML += `<div class="text-left text-sm text-gray-700 bg-white p-4 rounded border border-purple-200 mt-4">
                <h5 class="font-bold mb-2">💡 오답 노트</h5>
                <p class="mb-2 text-red-600 font-bold">틀린 문제 또는 안 푼 문제: ${wrongQuestions.join(', ')}</p>
                <p>각 문제 바로 아래에 표시된 <strong>해설(피드백)</strong>과 초록색으로 표시된 정답을 다시 한번 확인해보세요!</p>
            </div>`;
            
            resultDiv.innerHTML = feedbackHTML;
            resultDiv.className = "mt-6 text-xl font-bold bg-purple-50 p-6 rounded-xl text-center";
        }
    });

    // 분석 메모 — 입력 내용만큼 높이 자동 확장
    function autoResizeMemo(textarea) {
        if (!textarea) return;
        textarea.style.height = 'auto';
        textarea.style.height = `${Math.max(textarea.scrollHeight, 128)}px`;
    }

    document.querySelectorAll('#cpi-memo, #emp-memo, #my-memo').forEach(el => {
        autoResizeMemo(el);
        el.addEventListener('input', () => autoResizeMemo(el));
    });

    // html2canvas는 textarea 줄바꿈을 잘 못 그림 → 캡처 시 div로 치환
    function cloneMemoAsDiv(clonedDoc, originalArea, areaId) {
        const clonedArea = clonedDoc.getElementById(areaId);
        if (!originalArea || !clonedArea) return;

        originalArea.querySelectorAll('textarea.analysis-memo, textarea[id$="-memo"]').forEach(origTa => {
            autoResizeMemo(origTa);
            const clonedTa = clonedArea.querySelector(`#${origTa.id}`);
            if (!clonedTa) return;

            const div = clonedDoc.createElement('div');
            div.className = `${origTa.className} analysis-memo-capture`.replace(/\bresize-\w+\b/g, '');
            div.textContent = origTa.value || '';

            const cs = window.getComputedStyle(origTa);
            div.style.width = cs.width;
            div.style.padding = cs.padding;
            div.style.font = cs.font;
            div.style.color = cs.color;
            div.style.border = cs.border;
            div.style.borderRadius = cs.borderRadius;
            div.style.background = cs.backgroundColor;
            div.style.minHeight = `${Math.max(origTa.scrollHeight, 128)}px`;

            clonedTa.parentNode.replaceChild(div, clonedTa);
        });
    }

    // 분석 결과 캡처(이미지 저장) 기능
    const captureArea = (areaId, filename) => {
        const area = document.getElementById(areaId);
        if (!area) return;

        area.querySelectorAll('textarea[id$="-memo"]').forEach(autoResizeMemo);

        html2canvas(area, {
            scale: 2,
            backgroundColor: '#ffffff',
            useCORS: true,
            onclone: (clonedDoc) => cloneMemoAsDiv(clonedDoc, area, areaId)
        }).then(canvas => {
            const link = document.createElement('a');
            link.download = filename;
            link.href = canvas.toDataURL('image/png');
            link.click();
        }).catch(err => {
            console.error('캡처 실패:', err);
            alert('이미지 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.');
        });
    };

    // 이미지 저장 버튼 이벤트 리스너
    document.getElementById('cpi-save-btn')?.addEventListener('click', () => captureArea('cpi-capture-area', '소비자물가지수_분석결과.png'));
    document.getElementById('emp-save-btn')?.addEventListener('click', () => captureArea('emp-capture-area', '고용관련지표_분석결과.png'));
    document.getElementById('my-save-btn')?.addEventListener('click', () => saveMyChartImage());
});

// 챗봇용 — 현재 그래프·슬라이더 상태 공유
window.getEcomathContext = function() {
    const cpiStart = parseInt(document.getElementById('cpi-slider-start')?.value || '0', 10);
    const cpiEnd = parseInt(document.getElementById('cpi-slider-end')?.value || '0', 10);
    const empStart = parseInt(document.getElementById('emp-slider-start')?.value || '0', 10);
    const empEnd = parseInt(document.getElementById('emp-slider-end')?.value || '0', 10);

    const cpiHas = cpiGlobalData.labels.length > 0;
    const empHas = empGlobalData.labels.length > 0;

    let empDatasets = [];
    if (empHas) {
        const indicator = document.getElementById('emp-indicator-select')?.value || '';
        empDatasets = empGlobalData.datasets.filter(d => d.label.includes(indicator)).slice(0, 3);
    }

    const cpiLabels = cpiGlobalData.labels;
    const empLabels = empGlobalData.labels;

    return {
        cpi: cpiHas ? {
            hasData: true,
            labels: cpiGlobalData.labels,
            datasets: getFilteredDatasets('cpi-filter-checkboxes', cpiGlobalData.datasets).slice(0, 3),
            startIdx: cpiStart,
            endIdx: cpiEnd,
            rangeLabel: cpiLabels.length ? `${cpiLabels[cpiStart]} ~ ${cpiLabels[cpiEnd]}` : ''
        } : { hasData: false },
        emp: empHas ? {
            hasData: true,
            labels: empGlobalData.labels,
            datasets: empDatasets.length ? empDatasets : empGlobalData.datasets.slice(0, 3),
            startIdx: empStart,
            endIdx: empEnd,
            indicator: document.getElementById('emp-indicator-select')?.value || '',
            rangeLabel: empLabels.length ? `${empLabels[empStart]} ~ ${empLabels[empEnd]}` : ''
        } : { hasData: false }
    };
};
