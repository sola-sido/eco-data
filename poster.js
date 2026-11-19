const POSTER_STORAGE_KEY = 'ecomath-poster-v1';

function fitPosterField(field) {
    if (!field || field.tagName !== 'TEXTAREA') return;
    field.style.height = 'auto';
    field.style.height = `${Math.max(field.scrollHeight, field.classList.contains('poster-field-lg') ? 176 : 64)}px`;
}

function posterFields() {
    return [...document.querySelectorAll('#poster-sheet [data-poster-field]')];
}

function readPosterImageFile(file) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        const url = URL.createObjectURL(file);
        image.onload = () => {
            const maxWidth = 1600;
            const scale = Math.min(1, maxWidth / image.width);
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(image.width * scale));
            canvas.height = Math.max(1, Math.round(image.height * scale));
            canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL('image/jpeg', 0.86));
        };
        image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('이미지를 읽지 못했습니다.'));
        };
        image.src = url;
    });
}

function showPosterImage(slot, dataUrl) {
    const figure = document.querySelector(`.poster-figure[data-slot="${slot}"]`);
    if (!figure) return;
    const img = figure.querySelector('.poster-figure-img');
    const empty = figure.querySelector('.poster-figure-empty');
    const clearBtn = figure.querySelector('.poster-img-clear');
    if (!dataUrl) {
        img.removeAttribute('src');
        img.classList.add('hidden');
        empty.classList.remove('hidden');
        clearBtn.classList.add('hidden');
        return;
    }
    img.src = dataUrl;
    img.classList.remove('hidden');
    empty.classList.add('hidden');
    clearBtn.classList.remove('hidden');
}

function collectPosterState() {
    const fields = {};
    posterFields().forEach(field => {
        fields[field.id] = field.value;
    });
    const images = {};
    document.querySelectorAll('.poster-figure').forEach(figure => {
        const img = figure.querySelector('.poster-figure-img');
        if (img && img.src && img.src.startsWith('data:')) images[figure.dataset.slot] = img.src;
    });
    return { fields, images };
}

function savePosterState() {
    const state = collectPosterState();
    const note = document.getElementById('poster-save-state');
    try {
        localStorage.setItem(POSTER_STORAGE_KEY, JSON.stringify(state));
        if (note) note.textContent = '이 기기에 저장해 두었습니다.';
    } catch (error) {
        if (note) note.textContent = '글은 적혀 있지만, 이미지가 커서 브라우저 저장 공간이 부족할 수 있습니다. 한 장으로 저장한 뒤 남겨 두세요.';
    }
}

let posterSaveTimer = 0;
function schedulePosterSave() {
    window.clearTimeout(posterSaveTimer);
    posterSaveTimer = window.setTimeout(savePosterState, 350);
}

function restorePosterState() {
    const raw = localStorage.getItem(POSTER_STORAGE_KEY);
    if (!raw) return;
    try {
        const state = JSON.parse(raw);
        posterFields().forEach(field => {
            if (state.fields && Object.prototype.hasOwnProperty.call(state.fields, field.id)) {
                field.value = state.fields[field.id];
            }
            fitPosterField(field);
        });
        const images = { ...(state.images || {}) };
        ['1', '2', '3'].forEach(slot => {
            if (images[slot] && !images[`${slot}-app`]) images[`${slot}-app`] = images[slot];
        });
        Object.entries(images).forEach(([slot, dataUrl]) => showPosterImage(slot, dataUrl));
    } catch (error) {
        localStorage.removeItem(POSTER_STORAGE_KEY);
    }
}

async function setPosterSlotFile(slot, file) {
    if (!file || !file.type.startsWith('image/')) return;
    const dataUrl = await readPosterImageFile(file);
    showPosterImage(slot, dataUrl);
    schedulePosterSave();
}

function imageFileFromClipboard(event) {
    const items = event.clipboardData && event.clipboardData.items;
    if (!items) return null;
    for (const item of items) {
        if (item.type && item.type.startsWith('image/')) return item.getAsFile();
    }
    return null;
}

function savedAtLabel(date = new Date()) {
    const pad = value => String(value).padStart(2, '0');
    return `저장 일시: ${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function printPoster() {
    posterFields().forEach(fitPosterField);
    const savedAt = document.getElementById('poster-saved-at');
    if (savedAt) savedAt.textContent = savedAtLabel();
    const placeholders = posterFields().map(field => [field, field.getAttribute('placeholder')]);
    placeholders.forEach(([field]) => field.removeAttribute('placeholder'));
    document.body.classList.add('poster-printing');

    const nameField = document.getElementById('poster-name');
    const fileName = (nameField && nameField.value || '').trim().replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ');
    const previousTitle = document.title;
    if (fileName) document.title = fileName;

    const sheet = document.getElementById('poster-sheet');
    const heightMm = Math.max(840, Math.ceil((sheet.scrollHeight + 120) * 25.4 / 96));
    const style = document.getElementById('poster-page-style');
    if (style) {
        style.textContent = `@media print { @page { size: 420mm ${heightMm}mm; margin: 12mm; } }`;
    }

    const restore = () => {
        placeholders.forEach(([field, placeholder]) => {
            if (placeholder != null) field.setAttribute('placeholder', placeholder);
        });
        document.title = previousTitle;
        if (savedAt) savedAt.textContent = '';
        document.body.classList.remove('poster-printing');
        window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    window.requestAnimationFrame(() => window.print());
}

function setupPoster() {
    const sheet = document.getElementById('poster-sheet');
    if (!sheet) return;

    restorePosterState();
    posterFields().forEach(field => {
        fitPosterField(field);
        field.addEventListener('input', () => {
            fitPosterField(field);
            schedulePosterSave();
        });
    });

    document.querySelectorAll('.poster-figure').forEach(figure => {
        const slot = figure.dataset.slot;
        const fileInput = figure.querySelector('.poster-file');
        figure.querySelector('.poster-file-btn').addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            fileInput.click();
        });
        fileInput.addEventListener('change', async () => {
            const file = fileInput.files && fileInput.files[0];
            fileInput.value = '';
            if (file) await setPosterSlotFile(slot, file);
        });
        figure.addEventListener('click', () => figure.focus());
        figure.addEventListener('paste', async event => {
            const file = imageFileFromClipboard(event) || window.__ecomathCopiedChart || null;
            if (!file) return;
            event.preventDefault();
            await setPosterSlotFile(slot, file);
        });
        figure.addEventListener('dragover', event => event.preventDefault());
        figure.addEventListener('drop', async event => {
            event.preventDefault();
            const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
            if (file) await setPosterSlotFile(slot, file);
        });
        figure.querySelector('.poster-img-clear').addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            showPosterImage(slot, '');
            schedulePosterSave();
        });
    });

    document.getElementById('poster-print-btn').addEventListener('click', printPoster);
    document.getElementById('poster-clear-btn').addEventListener('click', () => {
        if (!window.confirm('포스터에 적은 글과 이미지를 지울까요?')) return;
        posterFields().forEach(field => {
            field.value = '';
            fitPosterField(field);
        });
        document.querySelectorAll('.poster-figure').forEach(figure => showPosterImage(figure.dataset.slot, ''));
        localStorage.removeItem(POSTER_STORAGE_KEY);
        const note = document.getElementById('poster-save-state');
        if (note) note.textContent = '내용을 지웠습니다.';
    });
}

document.addEventListener('DOMContentLoaded', setupPoster);
