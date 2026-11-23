const fs = require('fs');
const data = require('../js/pmo-seed-data.js');

const AZ_RAYON_COORDS = {
    "bakı": [40.4093, 49.8671], "abşeron": [40.4530, 49.7540], "sumqayıt": [40.5897, 49.6686],
    "gəncə": [40.6828, 46.3606], "mingəçevir": [40.7640, 47.0595], "şirvan": [39.9378, 48.9290],
    "naftalan": [40.5067, 46.8250], "ağcabədi": [40.0502, 47.4594], "ağdam": [39.9911, 46.9274],
    "ağdaş": [40.6470, 47.4738], "ağdərə": [40.2150, 46.8120], "ağsu": [40.5703, 48.4009],
    "astara": [38.4560, 48.8750], "babək": [39.1510, 45.4430], "balakən": [41.7263, 46.4048],
    "beyləqan": [39.7756, 47.6186], "bərdə": [40.3758, 47.1262], "biləsuvar": [39.4583, 48.5450],
    "cəbrayıl": [39.4000, 47.0260], "cəlilabad": [39.2096, 48.4919], "culfa": [38.9558, 45.6308],
    "daşkəsən": [40.5202, 46.0779], "füzuli": [39.6003, 47.1431], "gədəbəy": [40.5700, 45.8123],
    "goranboy": [40.6103, 46.7897], "göyçay": [40.6506, 47.7406], "göygöl": [40.5858, 46.3189],
    "hacıqabul": [40.0394, 48.9356], "imişli": [39.8709, 48.0600], "ismayıllı": [40.7871, 48.1519],
    "kəlbəcər": [40.1067, 46.0383], "kəngərli": [39.3872, 45.1636], "kürdəmir": [40.3425, 48.1564],
    "laçın": [39.6383, 46.5469], "lerik": [38.7739, 48.4150], "lənkəran": [38.7543, 48.8506],
    "masallı": [39.0353, 48.6654], "naxçıvan": [39.2089, 45.4122], "neftçala": [39.3768, 49.2470],
    "oğuz": [41.0713, 47.4653], "ordubad": [38.9096, 46.0227], "qax": [41.4183, 46.9204],
    "qazax": [41.0925, 45.3656], "qəbələ": [40.9814, 47.8458], "qobustan": [40.5336, 48.9282],
    "quba": [41.3611, 48.5134], "qubadlı": [39.3444, 46.5819], "qusar": [41.4275, 48.4302],
    "qarabağ": [39.8153, 46.7519], "saatlı": [39.9321, 48.3689], "sabirabad": [40.0087, 48.4770],
    "salyan": [39.5962, 48.9848], "samux": [40.7649, 46.4087], "sədərək": [39.7142, 44.8864],
    "siyəzən": [41.0761, 49.1139], "şabran": [41.2012, 48.9871], "şahbuz": [39.4072, 45.5739],
    "şamaxı": [40.6314, 48.6414], "şəki": [41.1919, 47.1706], "şəmkir": [40.8297, 46.0178],
    "şərur": [39.5528, 44.9799], "şuşa": [39.7601, 46.7499], "tərtər": [40.3420, 46.9316],
    "tovuz": [40.9925, 45.6284], "ucar": [40.5180, 47.6500], "xaçmaz": [41.4643, 48.8056],
    "xankəndi": [39.8153, 46.7519], "xızı": [40.9085, 49.0748], "xocalı": [39.9130, 46.7903],
    "xocavənd": [39.7915, 47.1101], "yardımlı": [38.9077, 48.2405], "yevlax": [40.6183, 47.1501],
    "zaqatala": [41.6316, 46.6448], "zəngilan": [39.0857, 46.6525], "zərdab": [40.2184, 47.7121]
};

function findKnown(name) {
    const clean = String(name || "")
        .replace(/\s*rayon(u)?\b/gi, "")
        .replace(/\s*şəhər(i)?\b/gi, "")
        .trim()
        .toLocaleLowerCase("az");
    if (!clean || clean === "rpş") return null;
    if (AZ_RAYON_COORDS[clean]) return [...AZ_RAYON_COORDS[clean]];
    for (const [k, v] of Object.entries(AZ_RAYON_COORDS)) {
        if (clean === k || clean.startsWith(k + " ") || clean.startsWith(k + "-") || clean.includes(k)) {
            return [...v];
        }
    }
    return null;
}

let updated = 0;
data.forEach(p => {
    (p.items || []).forEach(it => {
        if (it.isPmoRayon && !it.isMagistral) {
            const c = findKnown(it.name || it.rayon);
            if (c) {
                const old = it.coords?.[0];
                if (!old || Math.abs(old[0] - c[0]) > 0.001 || Math.abs(old[1] - c[1]) > 0.001) {
                    if (/balak/i.test(it.name)) {
                        console.log(`Balakən (${p.name}):`, old, '->', c);
                    }
                    it.coords = [c];
                    updated++;
                }
            }
        }
    });
});

console.log('Total rayon summary points snapped to exact rayon centers:', updated);
const out = `// Auto-generated PMO Seed Data - Offline Fallback
(function(root) {
    const data = ${JSON.stringify(data)};
    if (typeof window !== "undefined") {
        window.PMO_SEED_PROJECTS = data;
    }
    if (typeof module !== "undefined" && module.exports) {
        module.exports = data;
    }
})(typeof globalThis !== "undefined" ? globalThis : this);
`;
fs.writeFileSync('js/pmo-seed-data.js', out, 'utf8');
