const fs = require('fs');
const content = fs.readFileSync('js/app.js', 'utf8');

// Test running the code in a mocked DOM environment
const vm = require('vm');

const mockWindow = {
    addEventListener: () => {},
    removeEventListener: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    location: { href: 'http://localhost/', search: '' },
    navigator: { userAgent: 'test', clipboard: { writeText: async () => {} } },
    document: {
        getElementById: id => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        createElement: () => ({
            getContext: () => ({
                measureText: () => ({ width: 50 }),
                fillText: () => {},
                fillRect: () => {},
                beginPath: () => {},
                arc: () => {},
                fill: () => {},
                stroke: () => {},
                drawImage: () => {},
                getImageData: () => ({ data: [] })
            }),
            classList: { add: () => {}, remove: () => {}, toggle: () => {} },
            style: {}
        }),
        addEventListener: () => {},
        body: { classList: { add: () => {}, remove: () => {} } },
        head: { appendChild: () => {} },
        documentElement: { requestFullscreen: () => {} }
    },
    I18N: { az: {}, en: {}, ru: {} },
    BASE_MAPS: { satellite: { icon: '', label: '' } },
    STATUSES: ['layihe', 'icrada', 'bitmis', 'tehvil', 'lif_goturulen'],
    STATUS_COLORS: { layihe: '#f00', icrada: '#fa0', bitmis: '#0f0', tehvil: '#00f', lif_goturulen: '#f0f' },
    FOLDER_FIBER_COLORS: {},
    maplibregl: {
        Map: function() { return { on: () => {}, addControl: () => {}, resize: () => {}, flyTo: () => {} }; },
        Popup: function() { return { setText: () => ({ addTo: () => {} }) }; },
        Marker: function() { return { setLngLat: () => ({ setPopup: () => ({ addTo: () => {} }) }) }; },
        ScaleControl: function() {}
    }
};

mockWindow.window = mockWindow;
mockWindow.global = mockWindow;
mockWindow.globalThis = mockWindow;

const ctx = vm.createContext(mockWindow);
try {
    vm.runInContext(content, ctx);
    console.log('App.js executed successfully in mock browser environment!');
} catch (err) {
    console.error('Runtime error in app.js:', err);
}
