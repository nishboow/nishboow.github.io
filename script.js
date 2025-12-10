// ================= VARIABLES & CONFIGURATION =================

// 1. DONNÉES DES VILLES
const CITIES = [
    { "name": "PARIS", "lat": 48.8534, "lon": 2.3488, "prefix": "paris", "tag": "france" },
    { "name": "LILLE", "lat": 50.6330, "lon": 3.0586, "prefix": "lille", "tag": "france" },
    { "name": "BESANCON", "lat": 47.2488, "lon": 6.0181, "prefix": "besancon", "tag": "france" },
    { "name": "MT ST MICHEL", "lat": 48.6364, "lon": -1.5103, "prefix": "MtStMichel", "tag": "france" },
    { "name": "LONDRES", "lat": 51.5085, "lon": -0.1257, "prefix": "london", "tag": "monde" },
    { "name": "BERLIN", "lat": 52.5244, "lon": 13.4105, "prefix": "berlin", "tag": "monde" }
];

let currentCityIndex = 0;
let CONFIG = CITIES[0];
let simulationOffset = null; // null = temps réel

// Variables Système
let particleSystem = null;
let cloudSystem = null; // Remplacement de cloudLayer
let globalWeatherCode = 0; // Pour stocker le code météo actuel

// Variables Debug
let isWeatherDebug = false;
let debugWindSpeed = 10;
let debugWindDir = 270;

// Exposer les fonctions debug
window.forceWeather = forceWeather;
window.resetWeatherDebug = resetWeatherDebug;

function forceWeather(code) {
    isWeatherDebug = true;
    const data = {
        weather_code: code,
        wind_speed_10m: debugWindSpeed,
        wind_direction_10m: debugWindDir,
        temperature_2m: 15,
        is_day: 1
    };
    applyWeatherData(data);
}

function resetWeatherDebug() {
    isWeatherDebug = false;
    simulationOffset = null;
    updateAtmosphere();
    updateGlobalWeather();
}

// ================= DONNÉES DE MAPPING =================
const MAPS = {
    clouds: [-1, 0, 1, 2, 3],
    fog: [-1, 45, 48],
    drizzle: [-1, 51, 53, 55, 56, 57],
    rain: [-1, 61, 63, 65, 66, 67],
    snow: [-1, 71, 73, 75, 77],
    showers: [-1, 80, 81, 82, 85, 86],
    storm: [-1, 95, 96, 99]
};

const LABELS = {
    0: "Ensoleillé", 1: "Quelques nuages", 2: "Partiellement nuageux", 3: "Couvert",
    45: "Brouillard", 48: "Brouillard givrant",
    51: "Bruine légère", 53: "Bruine modérée", 55: "Bruine dense", 56: "Bruine v.", 57: "Bruine v.",
    61: "Pluie faible", 63: "Pluie modérée", 65: "Pluie forte", 66: "Pluie v.", 67: "Pluie v.",
    71: "Neige faible", 73: "Neige modérée", 75: "Neige forte", 77: "Grésil",
    80: "Averses faibles", 81: "Averses modér.", 82: "Averses viol.", 85: "Averses neige", 86: "Averses neige",
    95: "Orage", 96: "Orage & Grêle", 99: "Orage & Grêle",
    "-1": "Aucun"
};

const CATEGORY_NAMES = {
    clouds: "Ciel", fog: "Brouillard", drizzle: "Bruine", rain: "Pluie",
    snow: "Neige", showers: "Averses", storm: "Orages"
};

// ================= INITIALISATION =================

document.addEventListener('DOMContentLoaded', () => {
    // On utilise le même canvas pour TOUTE la météo (Nuages + Pluie)
    const canvas = document.getElementById('weather-canvas');
    
    if (canvas) {
        if (typeof SunCalc === 'undefined') console.warn("SunCalc non trouvé.");
        
        // Init des deux systèmes sur le même canvas
        cloudSystem = new CloudSystem(canvas);
        particleSystem = new ParticleSystem(canvas);
        
        // Init Resize
        resizeAll();
        
        // Lancement de la boucle unique
        loop();
    }

    setupUI();
    setupDebugUI();
    changeCityDirect(0);

    setInterval(updateAtmosphere, 60000);
    setInterval(updateGlobalWeather, 600000);

    window.addEventListener('resize', resizeAll);
});

function resizeAll() {
    if (particleSystem) particleSystem.resize();
    if (cloudSystem) cloudSystem.resize();
}

// ================= SYSTÈME DE NUAGES (NOUVEAU - CANVAS) =================

class CloudSystem {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.clouds = [];
        
        // Chargement Image
        this.cloudBitmap = new Image();
        this.cloudBitmap.src = 'cloud.webp'; // IMPORTANTE : Image requise !
        this.isLoaded = false;
        this.cloudBitmap.onload = () => { this.isLoaded = true; };

        // Config Physique
        this.windSpeed = 2.0;
        this.windDirectionDegrees = 270;
        this.velocityX = 0;
        this.velocityY = 0;
        
        // Config Objectifs
        this.targetCount = 10;
        this.targetScaleMin = 1.0;
        this.targetScaleMax = 2.0;

        // Config Brouillard
        this.isFoggy = false;
        this.fogAlpha = 0;
        this.maxFogAlpha = 200;

        this.updateWindVectors();
    }

    resize() {
        this.width = this.canvas.width;
        this.height = this.canvas.height;
    }

    setWind(speedKmH, directionDeg) {
        this.windSpeed = Math.max(0.3, speedKmH * 0.05); 
        this.windDirectionDegrees = directionDeg;
        this.updateWindVectors();
    }

    setDensity(code) {
        this.isFoggy = false;
        switch(parseInt(code)) {
            case 0: this.targetCount = 0; break;
            case 1: this.targetCount = 3; this.targetScaleMin = 0.5; this.targetScaleMax = 1.0; break;
            case 2: this.targetCount = 5; this.targetScaleMin = 0.8; this.targetScaleMax = 1.5; break;
            case 3: case 51: case 61: case 63: case 65: case 71: case 80: case 81: case 82:
                this.targetCount = 8; this.targetScaleMin = 1.5; this.targetScaleMax = 2.5; break;
            case 45: case 48:
                this.targetCount = 0; this.isFoggy = true; break;
            case 95: case 96: case 99:
                this.targetCount = 12; this.targetScaleMin = 2.0; this.targetScaleMax = 3.5; break;
            default: this.targetCount = 4; this.targetScaleMin = 1.0; this.targetScaleMax = 2.0;
        }
    }

    updateWindVectors() {
        const rad = this.windDirectionDegrees * (Math.PI / 180);
        this.velocityX = (-Math.sin(rad)) * this.windSpeed;
        this.velocityY = (Math.cos(rad)) * this.windSpeed;
    }

    createCloud(forceOnScreen) {
        if (!this.isLoaded) return null;

        const scale = Math.random() * (this.targetScaleMax - this.targetScaleMin) + this.targetScaleMin;
        const visualW = this.cloudBitmap.width * scale;
        const visualH = this.cloudBitmap.height * scale;
        let x, y;

        if (forceOnScreen) {
            x = Math.random() * this.width - (visualW / 2);
            y = Math.random() * this.height - (visualH / 2);
        } else {
            if (Math.abs(this.velocityX) > Math.abs(this.velocityY)) {
                x = (this.velocityX > 0) ? -visualW : this.width;
                y = Math.random() * this.height - (visualH / 2);
            } else {
                x = Math.random() * this.width - (visualW / 2);
                y = (this.velocityY > 0) ? -visualH : this.height;
            }
        }

        const alphaBase = (this.targetScaleMin > 2.0) ? 220 : 180;
        
        return {
            x: x, y: y, scale: scale,
            speedFactor: Math.random() * 0.4 + 0.6,
            alpha: 0, 
            maxAlpha: Math.floor(Math.random() * 50) + (alphaBase - 50),
            isDying: false
        };
    }

    update() {
        if (!this.isLoaded) return;

        // Brouillard transition
        if (this.isFoggy) { if (this.fogAlpha < this.maxFogAlpha) this.fogAlpha += 2; } 
        else { if (this.fogAlpha > 0) this.fogAlpha -= 2; }

        // Gestion population
        const activeCount = this.clouds.filter(c => !c.isDying).length;
        if (activeCount < this.targetCount && Math.random() < 0.02) {
            const c = this.createCloud(false);
            if(c) this.clouds.push(c);
        } else if (activeCount > this.targetCount) {
            const toKill = this.clouds.find(c => !c.isDying);
            if (toKill) toKill.isDying = true;
        }

        // Mouvement et Alpha
        for (let i = this.clouds.length - 1; i >= 0; i--) {
            let c = this.clouds[i];
            c.x += this.velocityX * c.speedFactor;
            c.y += this.velocityY * c.speedFactor;

            if (c.isDying) {
                c.alpha -= 2;
                if (c.alpha <= 0) { this.clouds.splice(i, 1); continue; }
            } else {
                if (c.alpha < c.maxAlpha) c.alpha += 2;
            }

            // Hors écran
            const w = this.cloudBitmap.width * c.scale;
            const h = this.cloudBitmap.height * c.scale;
            const margin = 500;
            const isOut = (this.velocityX > 0 && c.x > this.width + margin) ||
                          (this.velocityX < 0 && c.x + w < -margin) ||
                          (this.velocityY > 0 && c.y > this.height + margin) ||
                          (this.velocityY < 0 && c.y + h < -margin);

            if (isOut && !c.isDying) this.clouds.splice(i, 1);
        }
    }

    draw() {
        if (!this.isLoaded) return;

        // Nuages mobiles
        this.clouds.forEach(c => {
            if (c.alpha > 0) {
                this.ctx.globalAlpha = c.alpha / 255;
                const w = this.cloudBitmap.width * c.scale;
                const h = this.cloudBitmap.height * c.scale;
                this.ctx.drawImage(this.cloudBitmap, c.x, c.y, w, h);
            }
        });

        // Brouillard statique (Overlay)
        if (this.fogAlpha > 0) {
            this.ctx.globalAlpha = this.fogAlpha / 255;
            const scale = Math.max(this.width / this.cloudBitmap.width, this.height / this.cloudBitmap.height) * 1.5;
            const w = this.cloudBitmap.width * scale;
            const h = this.cloudBitmap.height * scale;
            this.ctx.drawImage(this.cloudBitmap, (this.width - w)/2, (this.height - h)/2, w, h);
        }
        this.ctx.globalAlpha = 1.0;
    }
}

// ================= PARTICULES (CANVAS) =================

class ParticleSystem {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.particles = [];
        this.type = 'NONE';
        this.intensity = 0;
        this.windX = 0;
        this.resize();
    }

    resize() {
        this.w = this.canvas.width = window.innerWidth;
        this.h = this.canvas.height = window.innerHeight;
    }

    configure(code, windSpeed, windDir) {
        let newType = 'NONE';
        let newIntensity = 0;

        if (code >= 51 && code <= 55) { newType = 'DRIZZLE'; newIntensity = 0.5; }
        else if (code >= 61 && code <= 65) { newType = 'RAIN'; newIntensity = 0.8; }
        else if (code >= 80 && code <= 82) { newType = 'RAIN'; newIntensity = 1.2; }
        else if (code >= 71 && code <= 75) { newType = 'SNOW'; newIntensity = 0.8; }
        else if (code >= 85 && code <= 86) { newType = 'SNOW'; newIntensity = 1.2; }
        else if (code === 77 || code === 96 || code === 99) { newType = 'HAIL'; newIntensity = 1.0; }
        else if (code >= 95) { newType = 'RAIN'; newIntensity = 1.5; }

        this.type = newType;
        this.intensity = newIntensity;

        const rad = (windDir - 90) * (Math.PI / 180);
        this.windX = Math.cos(rad) * (windSpeed * 0.3);

        let targetCount = 0;
        if (newType === 'RAIN') targetCount = 600 * newIntensity;
        if (newType === 'DRIZZLE') targetCount = 1000 * newIntensity;
        if (newType === 'SNOW') targetCount = 250 * newIntensity;
        if (newType === 'HAIL') targetCount = 400 * newIntensity;

        if (this.particles.length > targetCount) {
            this.particles.splice(targetCount);
        } else {
            while (this.particles.length < targetCount) {
                this.particles.push(this.createParticle());
            }
        }
    }

    createParticle() {
        return {
            x: Math.random() * this.w,
            y: Math.random() * this.h,
            z: Math.random() * 0.5 + 0.5,
            len: Math.random() * 20 + 10
        };
    }

    // Note : On ne clear plus le canvas ici, c'est fait dans loop()
    updateAndDraw() {
        if (this.type === 'NONE') return;

        const isRain = (this.type === 'RAIN' || this.type === 'DRIZZLE');
        this.ctx.lineWidth = isRain ? (this.type === 'DRIZZLE' ? 0.5 : 1.5) : 0;
        this.ctx.strokeStyle = 'rgba(174, 194, 224, 0.5)';
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';

        for (let p of this.particles) {
            let speedY = isRain ? (15 * p.z + this.intensity * 5) : (2 * p.z + this.intensity);
            p.y += speedY;
            p.x += this.windX * p.z;

            if (p.y > this.h) { p.y = -20; p.x = Math.random() * this.w; }
            if (p.x > this.w) p.x = 0;
            if (p.x < 0) p.x = this.w;

            this.ctx.beginPath();
            if (isRain) {
                this.ctx.moveTo(p.x, p.y);
                this.ctx.lineTo(p.x + (this.windX * 0.2), p.y + p.len);
                this.ctx.stroke();
            } else {
                const size = (this.type === 'HAIL' ? 3 : 2) * p.z;
                this.ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
                this.ctx.fill();
            }
        }
    }
}

// ================= BOUCLE D'ANIMATION GLOBALE =================

// Variable pour éviter trop d'éclairs
let lightningTimer = 0;

function loop() {
    const canvas = document.getElementById('weather-canvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 1. Nuages
        if (cloudSystem) {
            cloudSystem.update();
            cloudSystem.draw();
        }

        // 2. Particules (Pluie/Neige)
        if (particleSystem) {
            particleSystem.updateAndDraw();
        }
        
        // 3. GESTION DES ÉCLAIRS (NOUVEAU)
        const stormCodes = [95, 96, 99];
        if (stormCodes.includes(globalWeatherCode)) {
            lightningTimer++;
            // Probabilité d'éclair : Environ toutes les 2 à 10 secondes (à 60fps)
            // Math.random() < 0.005 signifie 0.5% de chance par frame
            if (lightningTimer > 60 && Math.random() < 0.005) {
                triggerLightning();
                lightningTimer = 0;
            }
        }
    }
    requestAnimationFrame(loop);
}

// Fonction qui déclenche l'effet visuel
function triggerLightning() {
    const overlay = document.getElementById('lightning-overlay');
    if (!overlay) return;

    // 1. Flash blanc
    overlay.classList.add('flash');

    // 2. On l'enlève rapidement (effet stroboscopique possible en ajoutant un timeout imbriqué)
    setTimeout(() => {
        overlay.classList.remove('flash');
        
        // Optionnel : Petit "rebond" de lumière (double flash)
        if (Math.random() > 0.5) {
            setTimeout(() => {
                overlay.classList.add('flash');
                setTimeout(() => overlay.classList.remove('flash'), 50);
            }, 100);
        }
    }, 150); // Durée du premier flash
}

// ================= API MÉTÉO =================

async function updateGlobalWeather() {
    if (isWeatherDebug || !CONFIG) return;
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${CONFIG.lat}&longitude=${CONFIG.lon}&current=temperature_2m,is_day,weather_code,wind_speed_10m,wind_direction_10m&timezone=auto`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.current) applyWeatherData(data.current);
    } catch (e) {
        console.error("Erreur Météo API", e);
    }
}

function applyWeatherData(data) {
    // 1. Sauvegarde Globale du code (CRUCIAL pour la couleur du ciel)
    globalWeatherCode = data.weather_code;

    const tempEl = document.getElementById('temp');
    const iconEl = document.getElementById('icon');
    const condEl = document.getElementById('condition');

    if (tempEl) tempEl.innerText = Math.round(data.temperature_2m) + "°";
    if (iconEl) iconEl.innerText = getIcon(data.weather_code, data.is_day);
    if (condEl) condEl.innerText = getDesc(data.weather_code);

    const windS = isWeatherDebug ? debugWindSpeed : data.wind_speed_10m;
    const windD = isWeatherDebug ? debugWindDir : data.wind_direction_10m;

    updateDebugDisplay(windS, windD);

    if (particleSystem) particleSystem.configure(data.weather_code, windS, windD);
    if (cloudSystem) {
        cloudSystem.setDensity(data.weather_code);
        cloudSystem.setWind(windS, windD);
    }

    const snowCodes = [71, 73, 75, 77, 85, 86];
    document.documentElement.style.setProperty('--snow-opacity', snowCodes.includes(data.weather_code) ? '1' : '0');

    // 2. On force la mise à jour de l'atmosphère immédiatement pour appliquer la couleur grise/orage
    updateAtmosphere();
}

// ================= GESTION INTERFACE & ATMOSPHERE =================
// (Code inchangé mais inclus pour complétion)

function setupUI() {
    const mainUI = document.getElementById('main-ui-trigger');
    const panel = document.getElementById('panel-overlay');
    const closeBtn = document.getElementById('btn-close-panel');
    const grid = document.getElementById('cities-grid');
    const debugBtn = document.getElementById('btn-open-debug');

    if (mainUI) mainUI.addEventListener('click', () => { renderCityGrid('all'); panel.classList.add('visible'); });
    if (closeBtn) closeBtn.addEventListener('click', () => panel.classList.remove('visible'));
    if (panel) panel.addEventListener('click', (e) => { if (e.target === panel) panel.classList.remove('visible'); });
    if (grid) enableDragScroll(grid);

    const filters = document.querySelectorAll('.filter-chip');
    filters.forEach(btn => {
        btn.addEventListener('click', () => {
            filters.forEach(f => f.classList.remove('active'));
            btn.classList.add('active');
            renderCityGrid(btn.getAttribute('data-filter'));
        });
    });

    if (debugBtn) debugBtn.addEventListener('click', () => {
        panel.classList.remove('visible');
        setTimeout(() => document.getElementById('debug-panel').classList.add('visible'), 300);
    });
}

function enableDragScroll(slider) {
    let isDown = false, startY, scrollTop;
    slider.addEventListener('mousedown', (e) => { isDown = true; slider.classList.add('grabbing'); startY = e.pageY - slider.offsetTop; scrollTop = slider.scrollTop; });
    slider.addEventListener('mouseleave', () => { isDown = false; slider.classList.remove('grabbing'); });
    slider.addEventListener('mouseup', () => { isDown = false; slider.classList.remove('grabbing'); });
    slider.addEventListener('mousemove', (e) => { if (!isDown) return; e.preventDefault(); const y = e.pageY - slider.offsetTop; const walk = (y - startY) * 2; slider.scrollTop = scrollTop - walk; });
}

function renderCityGrid(filterTag = 'all') {
    const grid = document.getElementById('cities-grid');
    grid.innerHTML = '';
    const filtered = CITIES.filter(c => filterTag === 'all' || c.tag === filterTag);

    if (filtered.length === 0) { grid.innerHTML = '<div style="color:#aaa; grid-column:1/-1; text-align:center;">Aucune ville.</div>'; return; }

    filtered.forEach((city) => {
        const realIndex = CITIES.indexOf(city);
        const card = document.createElement('div');
        card.className = `city-card ${realIndex === currentCityIndex ? 'selected' : ''}`;
        card.innerHTML = `<div class="city-card-bg" style="background-image: url('${city.prefix}_base.webp')"></div><div class="city-card-overlay"><span class="city-card-name">${city.name}</span></div>`;
        
        let startX, startY;
        card.addEventListener('mousedown', (e) => { startX = e.screenX; startY = e.screenY; });
        card.addEventListener('mouseup', (e) => {
            if (Math.abs(e.screenX - startX) < 5 && Math.abs(e.screenY - startY) < 5) {
                changeCityDirect(realIndex);
                document.getElementById('panel-overlay').classList.remove('visible');
            }
        });
        grid.appendChild(card);
    });
}

function changeCityDirect(index) {
    if (index < 0 || index >= CITIES.length) index = 0;
    currentCityIndex = index;
    CONFIG = CITIES[index];
    
    const nameDisplay = document.getElementById('city-display-name');
    if (nameDisplay) nameDisplay.innerText = CONFIG.name;

    const p = CONFIG.prefix;
    const setBg = (id, file) => { const el = document.getElementById(id); if (el) el.style.backgroundImage = `url('${file}')`; };

    setBg('base-layer', `${p}_base.webp`);
    setBg('snow-layer-back', `${p}_snow.webp`);
    setBg('light-layer-back', `${p}_lights.webp`);
    setBg('foreground-layer', `${p}_foreground.webp`);

    const maskUrl = `url('${p}_foreground.webp')`;
    ['snow-layer-front', 'light-layer-front'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.style.webkitMaskImage = maskUrl;
            el.style.maskImage = maskUrl;
            const type = id.includes('snow') ? 'snow' : 'lights';
            el.style.backgroundImage = `url('${p}_${type}.webp')`;
        }
    });

    updateAtmosphere();
    if (!isWeatherDebug) updateGlobalWeather();
}

const ATMOSPHERE_PALETTE = [
    { angle: -18, skyTop: [15, 32, 39], skyMid: [23, 45, 53], skyBottom: [32, 58, 67], hazeColor: [32, 58, 67], hazeOp: 0.3, cloudColor: [20, 40, 50], lightOp: 1.0, baseBright: 0.5, uiDark: true },
    { angle: -6, skyTop: [25, 50, 70], skyMid: [35, 65, 85], skyBottom: [45, 80, 100], hazeColor: [53, 92, 125], hazeOp: 0.5, cloudColor: [100, 110, 120], lightOp: 0.8, baseBright: 0.7, uiDark: true },
    { angle: 0, skyTop: [53, 92, 125], skyMid: [122, 100, 128], skyBottom: [192, 108, 132], hazeColor: [192, 108, 132], hazeOp: 0.6, cloudColor: [220, 200, 205], lightOp: 0.4, baseBright: 0.8, uiDark: false },
    { angle: 6, skyTop: [60, 100, 140], skyMid: [130, 160, 180], skyBottom: [200, 220, 225], hazeColor: [196, 224, 229], hazeOp: 0.5, cloudColor: [245, 245, 250], lightOp: 0.0, baseBright: 1.0, uiDark: false },
    { angle: 20, skyTop: [74, 114, 158], skyMid: [135, 169, 194], skyBottom: [196, 224, 229], hazeColor: [255, 255, 255], hazeOp: 0.4, cloudColor: [255, 255, 255], lightOp: 0.0, baseBright: 1.05, uiDark: false }
];

function updateAtmosphere() {
    if (!CONFIG) return;
    
    // --- 1. CALCUL DE L'HEURE (SOLAIRE) ---
    let now = new Date();
    if (simulationOffset !== null) {
        now = new Date(); now.setHours(0, 0, 0, 0);
        const hours = Math.floor(simulationOffset);
        now.setHours(hours, (simulationOffset - hours) * 60);
    }

    let sunAlt = 45;
    if (typeof SunCalc !== 'undefined') {
        const pos = SunCalc.getPosition(now, CONFIG.lat, CONFIG.lon);
        sunAlt = pos.altitude * (180 / Math.PI);
    }
    
    // Debug Heure
    const debugTime = document.getElementById('debug-time');
    if (debugTime) {
        const h = now.getHours().toString().padStart(2, '0');
        const m = now.getMinutes().toString().padStart(2, '0');
        debugTime.innerText = simulationOffset !== null ? `${h}:${m} (Sim)` : "Temps Réel";
    }

    // --- 2. COULEUR DE BASE (SELON LE SOLEIL) ---
    let angleClamped = Math.max(-18, Math.min(20, sunAlt));
    let startStep = ATMOSPHERE_PALETTE[0];
    let endStep = ATMOSPHERE_PALETTE[ATMOSPHERE_PALETTE.length - 1];

    for (let i = 0; i < ATMOSPHERE_PALETTE.length - 1; i++) {
        if (angleClamped >= ATMOSPHERE_PALETTE[i].angle && angleClamped <= ATMOSPHERE_PALETTE[i + 1].angle) {
            startStep = ATMOSPHERE_PALETTE[i]; endStep = ATMOSPHERE_PALETTE[i + 1]; break;
        }
    }
    const t = (angleClamped - startStep.angle) / (endStep.angle - startStep.angle);

    // Couleurs initiales (Soleil)
    let skyTop = lerpColor(startStep.skyTop, endStep.skyTop, t);
    let skyMid = lerpColor(startStep.skyMid, endStep.skyMid, t);
    let skyBottom = lerpColor(startStep.skyBottom, endStep.skyBottom, t);
    let cloudColor = lerpColor(startStep.cloudColor, endStep.cloudColor, t);
    let hazeOpacity = lerp(startStep.hazeOp, endStep.hazeOp, t);

    // --- 3. OVERRIDE MÉTÉO (LA NOUVELLE LOGIQUE) ---
    // On définit si on doit griser le ciel
    let weatherMix = 0.0; // 0 = Couleur Soleil, 1 = Couleur Météo pure
    let targetSky = [100, 115, 125]; // Gris par défaut (Pluie/Neige/Couvert)

    const c = parseInt(globalWeatherCode);

    // Détection des cas
    if ([95, 96, 99].includes(c)) {
        // ORAGE : Violet sombre + Mix fort
        targetSky = [40, 35, 60]; 
        weatherMix = 0.85; 
        cloudColor = [30, 30, 40]; // Nuages très sombres
    } 
    else if ([3, 61, 63, 65, 66, 67, 71, 73, 75, 77, 51, 53, 55].includes(c)) {
        // COUVERT / PLUIE / NEIGE (Pas averses) : Gris + Mix moyen
        targetSky = [100, 115, 125]; // Gris bleuté
        weatherMix = 0.8; 
        cloudColor = [180, 190, 200]; // Nuages gris uniformes
        hazeOpacity = 0.8; // Beaucoup de brume
    } 
    else if ([45, 48].includes(c)) {
        // BROUILLARD : Gris clair total
        targetSky = [180, 190, 200];
        weatherMix = 0.9;
        hazeOpacity = 1.0;
    }
    // Note: Les codes 80, 81, 82 (Averses) sont exclus ici, donc ils gardent la couleur du soleil (souvent arc-en-ciel/beau contraste)

    // APPLICATION DU MÉLANGE
    if (weatherMix > 0) {
        // On mélange la couleur du soleil avec la couleur météo
        skyTop = lerpColor(skyTop, targetSky, weatherMix);
        skyMid = lerpColor(skyMid, targetSky, weatherMix * 0.8); // On garde un peu de gradient au milieu
        skyBottom = lerpColor(skyBottom, targetSky, weatherMix * 0.6); // L'horizon garde un peu de teinte solaire
    }

    // --- 4. APPLICATION CSS ---
    const root = document.documentElement;
    root.style.setProperty('--sky-top', rgbStr(skyTop));
    root.style.setProperty('--sky-mid', rgbStr(skyMid));
    root.style.setProperty('--sky-bottom', rgbStr(skyBottom));
    root.style.setProperty('--haze-color', rgbaStr(skyBottom, 0.5)); // La brume prend la couleur du bas du ciel
    root.style.setProperty('--haze-opacity', hazeOpacity);
    root.style.setProperty('--cloud-color', rgbStr(cloudColor));
    
    // Luminosité globale
    // S'il fait "mauvais", on assombrit un peu la scène (baseBright)
    let baseBright = lerp(startStep.baseBright, endStep.baseBright, t);
    if (weatherMix > 0.5) baseBright *= 0.7; // 30% plus sombre si mauvais temps

    root.style.setProperty('--light-opacity', lerp(startStep.lightOp, endStep.lightOp, t));
    root.style.setProperty('--base-filter', `brightness(${baseBright}) contrast(1.1)`);

    // UI Dark mode si nuit OU Orage violent
    const isDarkBase = (endStep.uiDark && t > 0.5) || (startStep.uiDark && t < 0.5);
    const isStormDark = [95, 96, 99].includes(c);
    
    if (isDarkBase || isStormDark) document.body.classList.add('dark-ui');
    else document.body.classList.remove('dark-ui');
}

function setupDebugUI() {
    const debugPanel = document.getElementById('debug-panel');
    const closeBtn = document.getElementById('btn-close-debug');
    const resetBtn = document.getElementById('btn-reset-live');
    const timeSlider = document.getElementById('seekTime');
    const lblTime = document.getElementById('lbl-time');
    const windSpeedSlider = document.getElementById('seekWindSpeed');
    const windDirSlider = document.getElementById('seekWindDir');
    const uiContainer = document.querySelector('.ui-container');

    if (uiContainer) uiContainer.addEventListener('dblclick', () => debugPanel.classList.add('visible'));
    if (closeBtn) closeBtn.addEventListener('click', () => debugPanel.classList.remove('visible'));

    if (resetBtn) resetBtn.addEventListener('click', () => {
        resetAllSliders(); window.resetWeatherDebug();
        const originalText = resetBtn.innerText;
        resetBtn.innerText = "MODE LIVE ACTIVÉ !";
        setTimeout(() => resetBtn.innerText = originalText, 2000);
    });

    if (timeSlider) timeSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        simulationOffset = val / 60;
        const h = Math.floor(val / 60).toString().padStart(2, '0');
        const m = (val % 60).toString().padStart(2, '0');
        lblTime.innerText = `Heure forcée : ${h}:${m}`;
        lblTime.style.color = "#4CAF50";
        updateAtmosphere();
    });

    const updateDebugWind = () => {
        updateDebugDisplay(debugWindSpeed, debugWindDir);
        if (isWeatherDebug) forceUpdateDebugWeather();
    };

    if (windSpeedSlider) windSpeedSlider.addEventListener('input', (e) => { debugWindSpeed = parseFloat(e.target.value); updateDebugWind(); });
    if (windDirSlider) windDirSlider.addEventListener('input', (e) => { debugWindDir = parseFloat(e.target.value); updateDebugWind(); });

    function forceUpdateDebugWeather() {
        const activeSlider = document.querySelector('.weather-slider.active');
        let code = 0;
        if (activeSlider) {
            const category = activeSlider.getAttribute('data-cat');
            code = MAPS[category][parseInt(activeSlider.value)];
        } else {
            const tempCode = document.getElementById('temp-code-display')?.innerText;
            if (tempCode) code = parseInt(tempCode);
        }
        forceWeather(code);
    }

    const weatherSliders = document.querySelectorAll('.weather-slider');
    weatherSliders.forEach(slider => {
        slider.addEventListener('input', (e) => {
            const category = e.target.getAttribute('data-cat');
            const index = parseInt(e.target.value);
            const code = MAPS[category][index];

            if (index > 0) {
                weatherSliders.forEach(s => { if (s !== slider) { s.value = 0; updateLabel(s.getAttribute('data-cat'), 0); s.classList.remove('active'); } });
                slider.classList.add('active');
            } else { slider.classList.remove('active'); }

            updateLabel(category, index);
            if (code !== -1) forceWeather(code);
            else {
                let anyActive = false;
                weatherSliders.forEach(s => { if (parseInt(s.value) > 0) anyActive = true; });
                if (!anyActive) window.resetWeatherDebug();
            }
        });
    });
}

function updateLabel(category, index) {
    const labelEl = document.getElementById(`lbl-${category}`);
    const code = MAPS[category][index];
    const catName = CATEGORY_NAMES[category];
    if (code === -1) { labelEl.innerText = `${catName} : Aucun`; labelEl.classList.remove('active'); }
    else {
        const weatherName = LABELS[code] || "Inconnu";
        labelEl.innerText = `${catName} : ${weatherName} (Code: ${code})`;
        const debugDisp = document.getElementById('temp-code-display');
        if(debugDisp) debugDisp.innerText = code;
        labelEl.classList.add('active');
    }
}

function updateDebugDisplay(windS, windD) {
    const lblWindSpeed = document.getElementById('lbl-wind-speed');
    const lblWindDir = document.getElementById('lbl-wind-dir');
    const arrow = document.getElementById('wind-arrow');
    if (lblWindSpeed) lblWindSpeed.innerText = `Vitesse du vent : ${Math.round(windS)} km/h`;
    if (lblWindDir) lblWindDir.innerText = `Direction : ${Math.round(windD)}°`;
    if (arrow) arrow.style.transform = `rotate(${windD}deg)`;
}

function resetAllSliders() {
    const timeSlider = document.getElementById('seekTime');
    const lblTime = document.getElementById('lbl-time');
    if (timeSlider) { timeSlider.value = 720; lblTime.innerText = "Temps Réel"; lblTime.style.color = "#AAA"; simulationOffset = null; }
    const windSpeedSlider = document.getElementById('seekWindSpeed');
    const windDirSlider = document.getElementById('seekWindDir');
    if (windSpeedSlider) windSpeedSlider.value = 10;
    if (windDirSlider) windDirSlider.value = 270;
    debugWindSpeed = 10; debugWindDir = 270;
    updateDebugDisplay(debugWindSpeed, debugWindDir);
    const weatherSliders = document.querySelectorAll('.weather-slider');
    weatherSliders.forEach(s => { s.value = 0; updateLabel(s.getAttribute('data-cat'), 0); s.classList.remove('active'); });
}

function lerp(start, end, t) { return start * (1 - t) + end * t; }
function lerpColor(c1, c2, t) { return [Math.round(lerp(c1[0], c2[0], t)), Math.round(lerp(c1[1], c2[1], t)), Math.round(lerp(c1[2], c2[2], t))]; }
function rgbStr(c) { return `rgb(${c[0]},${c[1]},${c[2]})`; }
function rgbaStr(c, a) { return `rgba(${c[0]},${c[1]},${c[2]}, ${a})`; }

function getIcon(code, isDay) {
    if ([0].includes(code)) return isDay ? '☀️' : '🌙';
    if ([1].includes(code)) return isDay ? '🌤️' : '☁️';
    if ([2, 3].includes(code)) return '☁️';
    if ([45, 48].includes(code)) return '🌫️';
    if (code >= 51 && code <= 57) return '🌧️';
    if (code >= 61 && code <= 67) return '🌧️';
    if (code >= 71 && code <= 77) return '❄️';
    if (code >= 80 && code <= 82) return '⛈️';
    if (code >= 85 && code <= 86) return '🌨️';
    if (code >= 95) return '⚡';
    return '🌡️';
}
function getDesc(code) {
    const d = { 0: "Clair", 1: "Peu nuageux", 2: "Nuageux", 3: "Couvert", 45: "Brouillard", 48: "Givre", 51: "Bruine", 61: "Pluie", 63: "Pluie Mod.", 65: "Forte Pluie", 71: "Neige", 73: "Neige Mod.", 75: "Forte Neige", 80: "Averses", 95: "Orage" };
    return d[code] || "Variable";
}