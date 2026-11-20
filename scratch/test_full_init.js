const fs = require('fs');
const content = fs.readFileSync('js/app.js', 'utf8');
const seedData = require('../js/pmo-seed-data.js');
const vm = require('vm');

const elements = {};
function getEl(id) {
    if (!elements[id]) {
        elements[id] = {
            id,
            innerHTML: '',
            textContent: '',
            value: '',
            style: {},
            hidden: false,
            classList: {
                add: () => {},
                remove: () => {},
                toggle: () => {},
                contains: () => false
            },
            setAttribute: () => {},
            getAttribute: () => null,
            appendChild: () => {},
            addEventListener: () => {}
        };
    }
    return elements[id];
}

const mockDoc = {
    getElementById: getEl,
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: tag => getEl(tag),
    body: getEl('body'),
    documentElement: getEl('documentElement'),
    addEventListener: () => {}
};

const mockWindow = {
    addEventListener: () => {},
    removeEventListener: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    location: { href: 'http://localhost/', search: '', hash: '' },
    navigator: { userAgent: 'test', clipboard: { writeText: async () => {} } },
    document: mockDoc,
    I18N: { az: {} },
    BASE_MAPS: { satellite: { icon: '', label: '' } },
    STATUSES: ['layihe', 'icrada', 'bitmis', 'tehvil', 'lif_goturulen'],
    STATUS_COLORS: { layihe: '#f00', icrada: '#fa0', bitmis: '#0f0', tehvil: '#00f', lif_goturulen: '#f0f' },
    FOLDER_FIBER_COLORS: {},
    PMO_SEED_PROJECTS: seedData,
    maplibregl: {
        Map: function() {
            return {
                on: () => {},
                addControl: () => {},
                resize: () => {},
                flyTo: () => {},
                getZoom: () => 6,
                getBearing: () => 0,
                hasImage: () => false,
                addImage: () => {},
                getCanvasContainer: () => getEl('canvasContainer'),
                getSource: () => null,
                addSource: () => {},
                getLayer: () => null,
                addLayer: () => {}
            };
        },
        Popup: function() { return { setText: () => ({ addTo: () => {} }) }; },
        Marker: function() { return { setLngLat: () => ({ setPopup: () => ({ addTo: () => {} }) }) }; },
        ScaleControl: function() {}
    }
};

mockWindow.window = mockWindow;
mockWindow.global = mockWindow;
const ctx = vm.createContext(mockWindow);

try {
    vm.runInContext(content, ctx);
    console.log('1. Script parsed and executed');

    vm.runInContext(`
        state.projects = window.PMO_SEED_PROJECTS || [];
        state.activeFolders = new Set(['project', 'nim', 'azconnect', 'other']);
        state.visibleIds = new Set(state.projects.map(p => p.id));
        window.renderAll();
    `, ctx);
    console.log('2. window.renderAll() executed completely without error!');
} catch (e) {
    console.error('FAILED AT STEP:', e.message, e.stack);
}
