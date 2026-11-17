// ===== КОНСТАНТЫ =====
const STORAGE_KEY = 'todo.tasks.v1';
const THEME_KEY   = 'todo.theme';
const NOTIFY_KEY  = 'todo.notifyEnabled';
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн',
    'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

// ===== СОСТОЯНИЕ =====
let tasks = [];
let currentFilter = 'all';   // 'all' | 'active' | 'done' | 'overdue'
let drag = null;
let lastRenderDay = new Date().toDateString();

// ===== DOM =====
const form             = document.getElementById('form');
const input            = document.getElementById('input');
const dateInput        = document.getElementById('dateInput');
const list             = document.getElementById('list');
const empty            = document.getElementById('empty');
const counter          = document.getElementById('counter');
const clearDoneBtn     = document.getElementById('clearDone');
const filtersContainer = document.getElementById('filters');
const dateEl           = document.getElementById('date');
const themeToggle      = document.getElementById('themeToggle');
const notifyToggle     = document.getElementById('notifyToggle');
const overdueChip      = document.getElementById('overdueChip');
const overdueCountEl   = document.getElementById('overdueCount');
const overdueLabelEl   = document.getElementById('overdueLabel');

// ===== LOCALSTORAGE =====
function loadTasks() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        tasks = raw ? JSON.parse(raw) : [];
    } catch (e) {
        console.warn('Не удалось загрузить задачи:', e);
        tasks = [];
    }
}

function saveTasks() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch (e) {
        console.warn('Не удалось сохранить задачи:', e);
    }
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ===== ТЕМА =====
function applyTheme(theme, persist) {
    document.documentElement.setAttribute('data-theme', theme);
    themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
    themeToggle.setAttribute(
        'aria-label',
        theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'
    );
    if (persist) localStorage.setItem(THEME_KEY, theme);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') === 'dark'
        ? 'dark' : 'light';
    applyTheme(current === 'dark' ? 'light' : 'dark', true);
}

function initTheme() {
    const stored = localStorage.getItem(THEME_KEY);
    let theme;
    if (stored === 'dark' || stored === 'light') theme = stored;
    else if (document.documentElement.getAttribute('data-theme') === 'dark') theme = 'dark';
    else if (window.matchMedia('(prefers-color-scheme: dark)').matches) theme = 'dark';
    else theme = 'light';
    applyTheme(theme, false);
    themeToggle.addEventListener('click', toggleTheme);
}

// ===== ДЕДЛАЙНЫ =====
function formatDue(dateStr) {
    const [, m, d] = dateStr.split('-').map(Number);
    return `${d} ${MONTHS_SHORT[m - 1]}`;
}

function dueStatus(dateStr) {
    if (!dateStr) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [y, m, d] = dateStr.split('-').map(Number);
    const due = new Date(y, m - 1, d);
    const diff = Math.round((due - today) / 86400000);
    if (diff < 0) return 'overdue';
    if (diff === 0) return 'today';
    if (diff <= 2) return 'soon';
    return 'normal';
}

// Склонение слова «просрочено»
function pluralizeOverdue(n) {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    if (a >= 11 && a <= 14) return 'просрочено';
    if (b === 1) return 'просрочена';
    if (b >= 2 && b <= 4) return 'просрочены';
    return 'просрочено';
}

// ===== УВЕДОМЛЕНИЯ =====
function updateBellState() {
    if (!('Notification' in window)) {
        notifyToggle.hidden = true;
        return;
    }
    const perm = Notification.permission;
    const enabled = localStorage.getItem(NOTIFY_KEY) !== 'off';

    notifyToggle.classList.toggle('is-active', perm === 'granted' && enabled);
    notifyToggle.textContent = (perm === 'granted' && enabled) ? '🔔' : '🔕';

    if (perm === 'denied') {
        notifyToggle.title = 'Уведомления заблокированы в браузере';
    } else if (perm === 'granted') {
        notifyToggle.title = enabled
            ? 'Уведомления включены (нажмите, чтобы выключить)'
            : 'Уведомления выключены (нажмите, чтобы включить)';
    } else {
        notifyToggle.title = 'Включить уведомления о просроченных задачах';
    }
}

async function handleBellClick() {
    if (!('Notification' in window)) return;

    if (Notification.permission === 'denied') {
        alert('Уведомления заблокированы в настройках браузера. Разрешите их вручную для этого сайта.');
        return;
    }

    if (Notification.permission === 'default') {
        const p = await Notification.requestPermission();
        if (p === 'granted') localStorage.setItem(NOTIFY_KEY, 'on');
    } else {
        const enabled = localStorage.getItem(NOTIFY_KEY) !== 'off';
        localStorage.setItem(NOTIFY_KEY, enabled ? 'off' : 'on');
    }

    updateBellState();

    if (Notification.permission === 'granted' &&
        localStorage.getItem(NOTIFY_KEY) !== 'off') {
        sendNotifications();
    }
}

function sendNotifications() {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    if (localStorage.getItem(NOTIFY_KEY) === 'off') return;

    let changed = false;
    tasks.forEach(task => {
        if (task.done || !task.due || task.notified) return;
        if (dueStatus(task.due) !== 'overdue') return;

        try {
            new Notification('⚠️ Задача просрочена', {
                body: task.text,
                tag: 'todo-overdue-' + task.id
            });
            task.notified = true;
            changed = true;
        } catch (e) {
            console.warn('Не удалось показать уведомление:', e);
        }
    });
    if (changed) saveTasks();
}

// ===== ПРОВЕРКА ПРОСРОЧЕННЫХ =====
function checkOverdue() {
    const count = tasks.filter(t =>
        !t.done && t.due && dueStatus(t.due) === 'overdue'
    ).length;

    // Если были в фильтре «просроченные», а их больше нет — мягко выходим.
    if (count === 0 && currentFilter === 'overdue') {
        setFilter('all');
        return;
    }

    overdueCountEl.textContent = count;
    overdueLabelEl.textContent = pluralizeOverdue(count);

    const hasOverdue = count > 0;
    overdueChip.classList.toggle('has-overdue', hasOverdue);
    overdueChip.disabled = !hasOverdue;
    overdueChip.title = hasOverdue
        ? 'Показать просроченные задачи'
        : 'Просроченных задач нет';

    sendNotifications();
}

// ===== РЕДАКТИРОВАНИЕ ДЕДЛАЙНА =====
function startEditDeadline(li, task) {
    const body = li.querySelector('.task__body');
    if (!body) return;

    const old = body.querySelector('.task__deadline, .task__add-deadline');
    if (old) old.remove();

    const inp = document.createElement('input');
    inp.type = 'date';
    inp.className = 'task__deadline-input';
    inp.value = task.due || '';
    body.appendChild(inp);

    let finalized = false;

    const finalize = (save) => {
        if (finalized) return;
        finalized = true;

        if (save) {
            const val = inp.value || null;
            if (task.due !== val) {
                task.due = val;
                task.notified = false;
                saveTasks();
            }
        }
        render();
    };

    inp.addEventListener('change', () => finalize(true));
    inp.addEventListener('blur',   () => finalize(true));
    inp.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            e.preventDefault();
            finalized = true;
            render();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            finalize(true);
        }
    });

    inp.focus();
    if (inp.showPicker) {
        try { inp.showPicker(); } catch (err) { /* игнорируем */ }
    }
}

// ===== ОТРИСОВКА =====
function render() {
    const filtered = tasks.filter(task => {
        if (currentFilter === 'active')  return !task.done;
        if (currentFilter === 'done')    return task.done;
        if (currentFilter === 'overdue') return !task.done && task.due && dueStatus(task.due) === 'overdue';
        return true;
    });

    list.innerHTML = '';
    list.classList.toggle('is-draggable', currentFilter === 'all');
    empty.hidden = filtered.length > 0;

    filtered.forEach(task => {
        const li = document.createElement('li');
        li.className = 'task' + (task.done ? ' done' : '');
        li.dataset.id = task.id;

        // Ручка перетаскивания
        const handle = document.createElement('span');
        handle.className = 'task__handle';
        handle.textContent = '⠿';
        handle.title = 'Перетащите, чтобы изменить порядок';
        handle.addEventListener('pointerdown', e => startDrag(e, task.id));

        // Чекбокс
        const checkbox = document.createElement('div');
        checkbox.className = 'task__checkbox' + (task.done ? ' checked' : '');
        checkbox.textContent = task.done ? '✓' : '';
        checkbox.setAttribute('role', 'checkbox');
        checkbox.setAttribute('aria-checked', String(task.done));
        checkbox.addEventListener('click', () => toggleTask(task.id));

        // Тело задачи
        const body = document.createElement('div');
        body.className = 'task__body';

        const text = document.createElement('span');
        text.className = 'task__text';
        text.textContent = task.text;
        text.contentEditable = 'false';

        text.addEventListener('dblclick', () => {
            text.contentEditable = 'true';
            text.focus();
            const range = document.createRange();
            range.selectNodeContents(text);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        });

        text.addEventListener('blur', () => {
            text.contentEditable = 'false';
            const newText = text.textContent.trim();
            if (newText === '') deleteTask(task.id);
            else updateTaskText(task.id, newText);
        });

        text.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); text.blur(); }
            if (e.key === 'Escape') {
                text.textContent = task.text;
                text.blur();
            }
        });

        body.appendChild(text);

        // Дедлайн-бейдж или кнопка «+ дата»
        if (task.due) {
            const dl = document.createElement('span');
            const status = dueStatus(task.due);
            dl.className = 'task__deadline deadline--' + status;
            dl.textContent = '📅 ' + formatDue(task.due);
            dl.title = 'Нажмите, чтобы изменить дедлайн';
            dl.addEventListener('click', e => {
                e.stopPropagation();
                startEditDeadline(li, task);
            });
            body.appendChild(dl);
        } else {
            const addDl = document.createElement('button');
            addDl.type = 'button';
            addDl.className = 'task__add-deadline';
            addDl.textContent = '+ дата';
            addDl.title = 'Добавить дедлайн';
            addDl.addEventListener('click', e => {
                e.stopPropagation();
                startEditDeadline(li, task);
            });
            body.appendChild(addDl);
        }

        // Кнопка удаления
        const delBtn = document.createElement('button');
        delBtn.className = 'task__delete';
        delBtn.textContent = '×';
        delBtn.setAttribute('aria-label', 'Удалить задачу');
        delBtn.addEventListener('click', () => deleteTask(task.id));

        li.append(handle, checkbox, body, delBtn);
        list.appendChild(li);
    });

    updateCounter();
    clearDoneBtn.disabled = !tasks.some(t => t.done);
    checkOverdue();
}

function updateCounter() {
    const active = tasks.filter(t => !t.done).length;
    const total = tasks.length;
    counter.textContent = total === 0 ? '0 задач' : `${active} из ${total} осталось`;
}

// ===== ДЕЙСТВИЯ =====
function addTask(text, due) {
    const trimmed = text.trim();
    if (!trimmed) return;
    tasks.unshift({
        id: generateId(),
        text: trimmed,
        done: false,
        due: due || null,
        notified: false
    });
    saveTasks();
    render();
    input.value = '';
    dateInput.value = '';
    input.focus();
}

function toggleTask(id) {
    const task = tasks.find(t => t.id === id);
    if (task) {
        task.done = !task.done;
        if (!task.done) task.notified = false;
        saveTasks();
        render();
    }
}

function deleteTask(id) {
    tasks = tasks.filter(t => t.id !== id);
    saveTasks();
    render();
}

function updateTaskText(id, newText) {
    const task = tasks.find(t => t.id === id);
    if (task && task.text !== newText) {
        task.text = newText;
        saveTasks();
        render();
    }
}

function clearDone() {
    tasks = tasks.filter(t => !t.done);
    saveTasks();
    render();
}

function setFilter(filter) {
    currentFilter = filter;
    document.querySelectorAll('.filters__btn').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.filter === filter);
    });
    overdueChip.classList.toggle('is-active', filter === 'overdue');
    render();
}

// ===== DRAG & DROP =====
function startDrag(e, taskId) {
    if (currentFilter !== 'all') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const li = e.currentTarget.closest('.task');
    if (!li) return;

    e.preventDefault();
    drag = { id: taskId, el: li, startY: e.clientY, active: false };

    document.addEventListener('pointermove', onDragMove);
    document.addEventListener('pointerup', onDragEnd);
    document.addEventListener('pointercancel', onDragEnd);
}

function onDragMove(e) {
    if (!drag) return;

    if (!drag.active) {
        if (Math.abs(e.clientY - drag.startY) < 6) return;
        drag.active = true;
        drag.el.classList.add('dragging');
    }

    e.preventDefault();

    const under = document.elementFromPoint(e.clientX, e.clientY);
    const target = under && under.closest ? under.closest('.task') : null;
    if (!target || target === drag.el) return;

    const rect = target.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    if (after) target.after(drag.el);
    else target.before(drag.el);
}

function onDragEnd() {
    document.removeEventListener('pointermove', onDragMove);
    document.removeEventListener('pointerup', onDragEnd);
    document.removeEventListener('pointercancel', onDragEnd);
    if (!drag) return;

    const wasActive = drag.active;
    drag.el.classList.remove('dragging');
    drag = null;

    if (wasActive) {
        const ids = [...list.querySelectorAll('.task')].map(li => li.dataset.id);
        tasks.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
        saveTasks();
        render();
    }
}

// ===== ДАТА В ШАПКЕ =====
function updateDate() {
    const now = new Date();
    const options = { weekday: 'long', day: 'numeric', month: 'long' };
    dateEl.textContent = now.toLocaleDateString('ru-RU', options);
}

// ===== ИНИЦИАЛИЗАЦИЯ =====
function init() {
    initTheme();
    updateBellState();
    loadTasks();
    updateDate();
    render();

    form.addEventListener('submit', e => {
        e.preventDefault();
        addTask(input.value, dateInput.value);
    });

    filtersContainer.addEventListener('click', e => {
        const btn = e.target.closest('.filters__btn');
        if (btn) setFilter(btn.dataset.filter);
    });

    clearDoneBtn.addEventListener('click', clearDone);
    notifyToggle.addEventListener('click', handleBellClick);

    // Клик по чипу — фильтр «просроченные»
    overdueChip.addEventListener('click', () => {
        if (overdueChip.disabled) return;
        setFilter(currentFilter === 'overdue' ? 'all' : 'overdue');
    });

    // Раз в минуту: проверка уведомлений + смена дня
    setInterval(() => {
        const today = new Date().toDateString();
        if (today !== lastRenderDay) {
            lastRenderDay = today;
            updateDate();
            render();
        } else {
            checkOverdue();
        }
    }, 60000);

    input.focus();
}

document.addEventListener('DOMContentLoaded', init);