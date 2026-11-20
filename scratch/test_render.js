const fs = require('fs');
const content = fs.readFileSync('js/app.js', 'utf8');
const vm = require('vm');
const mockDoc = {
    addEventListener: () => {},
    getElementById: () => ({ innerHTML: '', textContent: '', style: {}, classList: { toggle: () => {} } }),
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: () => ({ getContext: () => ({ measureText: () => ({ width: 50 }) }) }),
    body: { classList: { add: () => {}, remove: () => {} } }
};
const mockWindow = {
    addEventListener: () => {},
    localStorage: { getItem: () => null, setItem: () => {} },
    location: { href: 'http://localhost/', search: '' },
    navigator: { userAgent: 'test' },
    document: mockDoc,
    I18N: { az: {} },
    BASE_MAPS: {},
    STATUSES: [],
    STATUS_COLORS: {},
    FOLDER_FIBER_COLORS: {}
};
mockWindow.window = mockWindow;
mockWindow.global = mockWindow;
const ctx = vm.createContext(mockWindow);
vm.runInContext(content, ctx);

try {
    vm.runInContext(`
        state.projects = [{
            id: 'p1',
            name: '10.239 region',
            category: 'project',
            type: 'points',
            status: 'icrada',
            items: [],
            isPmo: true,
            pmoMeta: { sheetId: '10', overallPct: 50, bcgDone: 1, bcgPlan: 2, avicomDone: 1, avicomPlan: 2 }
        }];
        state.activeFolders = new Set(['project']);
        state.visibleIds = new Set(['p1']);
        renderProjects();
    `, ctx);
    console.log('renderProjects() SUCCESS');
} catch (e) {
    console.error('renderProjects() CAUGHT ERROR:', e.message);
}
