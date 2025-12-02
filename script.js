// ================= VARIABLES GLOBALES =================
let CITIES = []; 
let CONFIG = null; 
let currentCityIndex = 0;
let simulationOffset = null; 

let isWeatherDebug = false; 
let debugWindSpeed = 10;    
let debugWindDir = 270; 

const cloudLayer = document.getElementById('cloud-layer');
let currentCloudCount = 0;

const canvas = document.getElementById('weather-canvas');
const ctx = canvas.getContext('2d');
let w, h, particles = [], animationId = null;

// ================= INITIALISATION DYNAMIQUE =================

async function initSystem() {
    try {
        const response = await fetch('cities.json');
        if (!response.ok) throw new Error("Fichier cities.json introuvable");
        CITIES = await response.json();
        
        // --- GESTION DE LA RECHERCHE (Dropdown Personnalisé) ---
        const input = document.getElementById('city-input');
        const dropdown = document.getElementById('custom-dropdown');

        // Fonction pour remplir la liste (filtrée ou non)
        function populateDropdown(filterText = '') {
            dropdown.innerHTML = ''; // On vide la liste précédente
            
            const filteredCities = CITIES.filter(city => 
                city.name.toLowerCase().includes(filterText.toLowerCase())
            );

            // --- CAS 1 : AUCUNE VILLE TROUVÉE ---
            if (filteredCities.length === 0) {
                const message = document.createElement('div');
                message.className = 'dropdown-message';
                
                // On affiche le message personnalisé
                // On utilise filterText pour rappeler ce que l'utilisateur a tapé
                message.innerHTML = `⚠️ <strong style="text-transform: capitalize;">${filterText}</strong> n'est pas disponible.<br>Peut-être dans une future mise à jour !`;
                
                dropdown.appendChild(message);
                dropdown.style.display = 'block'; // On force l'affichage pour montrer le message
                return;
            }

            // --- CAS 2 : VILLES TROUVÉES (Logique habituelle) ---
            filteredCities.forEach(city => {
                const item = document.createElement('div');
                item.className = 'dropdown-item';
                item.innerText = city.name;
                
                item.addEventListener('click', () => {
                    const index = CITIES.findIndex(c => c.name === city.name);
                    currentCityIndex = index;
                    changeCity(0);
                    input.value = city.name; 
                    dropdown.style.display = 'none';
                });
                
                dropdown.appendChild(item);
            });
            
            dropdown.style.display = 'block';
        }

        input.addEventListener('input', (e) => populateDropdown(e.target.value));
        
        input.addEventListener('focus', () => {
            input.value = ''; // Vide pour faciliter la recherche
            populateDropdown();
        });

        // Fermer si clic ailleurs
        document.addEventListener('click', (e) => {
            if (!input.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.style.display = 'none';
                if (CONFIG) input.value = CONFIG.name;
            }
        });

        setupUIListeners();
        window.addEventListener('resize', resizeCanvas);
        resizeCanvas();

        if (CITIES.length > 0) changeCity(0); 

        setInterval(updateAtmosphere, 60000); 
        setInterval(updateGlobalWeather, 600000); 

    } catch (error) {
        console.error("Erreur critique :", error);
    }
}

// ================= GESTION VILLES =================

function changeCity(direction) {
    if (CITIES.length === 0) return;

    // Calcul index (utile pour future navigation)
    currentCityIndex += direction;
    if (currentCityIndex < 0) currentCityIndex = CITIES.length - 1;
    if (currentCityIndex >= CITIES.length) currentCityIndex = 0;

    CONFIG = CITIES[currentCityIndex];
    const input = document.getElementById('city-input');
    if(input) input.value = CONFIG.name;

    // Images
    const p = CONFIG.prefix;
    document.getElementById('base-layer').style.backgroundImage = `url('${p}_base.webp')`;
    document.getElementById('snow-layer-back').style.backgroundImage = `url('${p}_snow.webp')`;
    document.getElementById('light-layer-back').style.backgroundImage = `url('${p}_lights.webp')`;
    document.getElementById('foreground-layer').style.backgroundImage = `url('${p}_foreground.webp')`;
    
    const snowFront = document.getElementById('snow-layer-front');
    const lightFront = document.getElementById('light-layer-front');
    const maskUrl = `url('${p}_foreground.webp')`;
    
    snowFront.style.backgroundImage = `url('${p}_snow.webp')`;
    lightFront.style.backgroundImage = `url('${p}_lights.webp')`;
    
    snowFront.style.maskImage = maskUrl;
    snowFront.style.webkitMaskImage = maskUrl;
    lightFront.style.maskImage = maskUrl;
    lightFront.style.webkitMaskImage = maskUrl;

    if(isWeatherDebug) resetWeatherDebug();
    updateAtmosphere();
    updateGlobalWeather();
}

// ================= ATMOSPHÈRE =================

const ATMOSPHERE_PALETTE = [
    { angle: -18, skyTop: [2, 4, 8], skyMid: [7, 11, 20], skyBottom: [16, 24, 38], hazeColor: [150, 180, 255], hazeOp: 0.3, cloudColor: [31, 34, 43], lightOp: 1.0, baseBright: 0.5, uiDark: true },
    { angle: -6, skyTop: [22, 30, 60], skyMid: [46, 59, 100], skyBottom: [138, 79, 82], hazeColor: [150, 50, 50], hazeOp: 0.5, cloudColor: [80, 90, 117], lightOp: 0.8, baseBright: 0.7, uiDark: true },
    { angle: 0, skyTop: [44, 62, 117], skyMid: [196, 108, 77], skyBottom: [255, 179, 71], hazeColor: [255, 200, 100], hazeOp: 0.8, cloudColor: [255, 232, 201], lightOp: 0.4, baseBright: 0.8, uiDark: false },
    { angle: 6, skyTop: [40, 70, 130], skyMid: [100, 150, 200], skyBottom: [220, 190, 150], hazeColor: [255, 240, 200], hazeOp: 0.6, cloudColor: [255, 250, 240], lightOp: 0.0, baseBright: 1.0, uiDark: false },
    { angle: 20, skyTop: [26, 75, 140], skyMid: [74, 138, 212], skyBottom: [159, 200, 232], hazeColor: [255, 255, 230], hazeOp: 0.5, cloudColor: [255, 255, 255], lightOp: 0.0, baseBright: 1.05, uiDark: false }
];

function getSunPhase(date) {
    if (typeof SunCalc === 'undefined' || !CONFIG) return 45; 
    const pos = SunCalc.getPosition(date, CONFIG.lat, CONFIG.lon);
    return pos.altitude * (180 / Math.PI); 
}

function updateAtmosphere() {
    if(!CONFIG) return;
    let now = new Date();
    if (simulationOffset !== null) {
        now = new Date(); now.setHours(0, 0, 0, 0);
        const hours = Math.floor(simulationOffset);
        now.setHours(hours, (simulationOffset - hours) * 60);
    }
    
    let sunAlt = getSunPhase(now);
    if (sunAlt < -18) sunAlt = -18; if (sunAlt > 20) sunAlt = 20;

    let startStep = ATMOSPHERE_PALETTE[0]; let endStep = ATMOSPHERE_PALETTE[ATMOSPHERE_PALETTE.length - 1];
    for (let i = 0; i < ATMOSPHERE_PALETTE.length - 1; i++) {
        if (sunAlt >= ATMOSPHERE_PALETTE[i].angle && sunAlt <= ATMOSPHERE_PALETTE[i+1].angle) {
            startStep = ATMOSPHERE_PALETTE[i]; endStep = ATMOSPHERE_PALETTE[i+1]; break;
        }
    }
    
    const progress = (sunAlt - startStep.angle) / (endStep.angle - startStep.angle);
    const root = document.documentElement;
    
    root.style.setProperty('--sky-top', rgbStr(lerpColor(startStep.skyTop, endStep.skyTop, progress)));
    root.style.setProperty('--sky-mid', rgbStr(lerpColor(startStep.skyMid, endStep.skyMid, progress)));
    root.style.setProperty('--sky-bottom', rgbStr(lerpColor(startStep.skyBottom, endStep.skyBottom, progress)));
    
    root.style.setProperty('--haze-color', rgbaStr(lerpColor(startStep.hazeColor, endStep.hazeColor, progress), 0.5));
    root.style.setProperty('--haze-opacity', lerp(startStep.hazeOp, endStep.hazeOp, progress));

    root.style.setProperty('--cloud-color', rgbStr(lerpColor(startStep.cloudColor, endStep.cloudColor, progress)));
    root.style.setProperty('--light-opacity', lerp(startStep.lightOp, endStep.lightOp, progress));
    root.style.setProperty('--base-filter', `brightness(${lerp(startStep.baseBright, endStep.baseBright, progress)}) contrast(1.1)`);

    if (endStep.uiDark && progress > 0.5 || startStep.uiDark && progress < 0.5) document.body.classList.add('dark-ui');
    else document.body.classList.remove('dark-ui');

    if(simulationOffset !== null) {
        const h = now.getHours().toString().padStart(2,'0'); const m = Math.floor(now.getMinutes()).toString().padStart(2,'0');
        document.getElementById('debug-time').innerText = `${h}:${m} (Alt: ${sunAlt.toFixed(1)}°)`;
    }
}

// ================= NUAGES & FX =================

function updateWind(speedKmH, directionDeg) {
    let duration = 100 - speedKmH; if (duration < 20) duration = 20; 
    const destAngleRad = (directionDeg + 180) * (Math.PI / 180);
    const tx = Math.sin(destAngleRad) * 150; const ty = -Math.cos(destAngleRad) * 150;
    cloudLayer.style.setProperty('--wind-duration', `${duration}s`);
    cloudLayer.style.setProperty('--tx', `${tx}vmax`); cloudLayer.style.setProperty('--ty', `${ty}vmax`);
}

function createComplexCloud() {
    const cloud = document.createElement('div'); cloud.classList.add('cloud'); cloud.style.opacity = '0';
    const width = Math.floor(Math.random() * 750) + 150; const height = Math.floor(width * (0.3 + Math.random() * 0.2)); 
    cloud.style.width = `${width}px`; cloud.style.height = `${height}px`;
    cloud.style.top = `${Math.random() * 160-30}%`; cloud.style.left = `${Math.random() * 160-30}%`;
    cloud.style.animationDelay = `-${Math.random() * 100}s`;
    cloud.style.filter = `blur(${20 + Math.random() * 40}px)`;
    cloudLayer.appendChild(cloud);
    setTimeout(() => { cloud.style.opacity = ''; }, 10);
}

function manageCloudPopulation(targetCount) {
    if (currentCloudCount === targetCount) return;
    if (currentCloudCount < targetCount) {
        while (currentCloudCount < targetCount) { createComplexCloud(); currentCloudCount++; }
    } else if (currentCloudCount > targetCount) {
        const clouds = document.querySelectorAll('.cloud:not(.dying)');
        while (currentCloudCount > targetCount && clouds.length > 0) {
            const cloudToRemove = clouds[currentCloudCount - 1];
            if (cloudToRemove) {
                cloudToRemove.classList.add('dying'); cloudToRemove.style.opacity = '0';
                setTimeout(() => { if(cloudToRemove.parentNode) cloudToRemove.remove(); }, 2000);
            }
            currentCloudCount--;
        }
    }
}

// PARTICLES
function resizeCanvas(){ w=canvas.width=window.innerWidth; h=canvas.height=window.innerHeight; }
class Particle {
    constructor(type) { this.type = type; this.reset(); }
    reset() {
        this.x = Math.random() * w; this.y = Math.random() * -h; 
        if (this.type === 'rain') { this.vy = Math.random() * 10 + 10; this.vx = Math.random() * 1 - 0.5; this.len = Math.random() * 20 + 10; }
        else if (this.type === 'snow') { this.vy = Math.random() * 2 + 1; this.vx = Math.random() * 2 - 1; this.size = Math.random() * 3 + 1; }
    }
    update() { this.y += this.vy; this.x += this.vx; if (this.y > h) this.reset(); }
    draw() {
        if (this.type === 'rain') { ctx.beginPath(); ctx.strokeStyle = 'rgba(174, 194, 224, 0.5)'; ctx.lineWidth = 1; ctx.moveTo(this.x, this.y); ctx.lineTo(this.x + this.vx, this.y + this.len); ctx.stroke(); }
        else if (this.type === 'snow') { ctx.beginPath(); ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'; ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2); ctx.fill(); }
    }
}
function startPrecipitation(type) {
    if (animationId) cancelAnimationFrame(animationId); particles = [];
    for(let i=0; i<(type==='rain'?500:200); i++) particles.push(new Particle(type));
    function loop() { ctx.clearRect(0, 0, w, h); particles.forEach(p => { p.update(); p.draw(); }); animationId = requestAnimationFrame(loop); } loop();
}
function stopPrecipitation() { if (animationId) cancelAnimationFrame(animationId); ctx.clearRect(0, 0, w, h); }

// API METEO
function applyWeatherData(data) {
    document.getElementById('temp').innerText = Math.round(data.temperature_2m) + "°";
    document.getElementById('icon').innerText = getIcon(data.weather_code, data.is_day);
    document.getElementById('condition').innerText = getDesc(data.weather_code);
    const windS = isWeatherDebug ? debugWindSpeed : data.wind_speed_10m; const windD = isWeatherDebug ? debugWindDir : data.wind_direction_10m;
    updateDebugDisplay(windS, windD); updateWind(windS, windD);
    manageCloudPopulation(getCloudCountFromCode(data.weather_code));
    
    const root = document.documentElement;
    if ([45, 48].includes(data.weather_code)) { root.style.setProperty('--cloud-filter', 'blur(25px)'); root.style.setProperty('--cloud-opacity', '0.4'); }
    else { root.style.setProperty('--cloud-filter', 'blur(5px)'); root.style.setProperty('--cloud-opacity', '0.6'); }
    
    stopPrecipitation();
    if ([51,53,55,61,63,65,80,81,82].includes(data.weather_code)) startPrecipitation('rain');
    else if ([71,73,75,77,85,86].includes(data.weather_code)) startPrecipitation('snow');
    
    if ([71, 73, 75, 85, 86].includes(data.weather_code)) root.style.setProperty('--snow-opacity', '1'); 
    else root.style.setProperty('--snow-opacity', '0');
}

async function updateGlobalWeather() {
    if (isWeatherDebug || !CONFIG) return;
    try {
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${CONFIG.lat}&longitude=${CONFIG.lon}&current=temperature_2m,is_day,weather_code,wind_speed_10m,wind_direction_10m&timezone=auto`);
        const data = await res.json(); applyWeatherData(data.current);
    } catch (e) { console.error("Erreur Météo:", e); }
}

// UTILS
function setupUIListeners() {
    const uiBox = document.querySelector('.ui-container'); const debugBox = document.querySelector('.debug-panel');
    uiBox.addEventListener('dblclick', () => debugBox.classList.toggle('visible'));
    document.getElementById('scene').addEventListener('click', (e) => { if (e.target.id === 'background-sky' || e.target.id === 'scene') debugBox.classList.remove('visible'); });
    document.getElementById('time-slider').addEventListener('input', (e) => { simulationOffset = parseFloat(e.target.value); updateAtmosphere(); });
    document.getElementById('wind-slider').addEventListener('input', (e) => forceWindSpeed(e.target.value));
    document.getElementById('wind-dir-slider').addEventListener('input', (e) => forceWindDir(e.target.value));
}
function resetTime() { simulationOffset = null; document.getElementById('debug-time').innerText = "Temps Réel"; updateAtmosphere(); }
function forceWeather(code) { isWeatherDebug = true; applyWeatherData({ temperature_2m: 15, is_day: 1, weather_code: code, wind_speed_10m: debugWindSpeed, wind_direction_10m: debugWindDir }); }
function forceWindSpeed(val) { debugWindSpeed = parseFloat(val); if (isWeatherDebug) refreshWindOnly(); }
function forceWindDir(val) { debugWindDir = parseFloat(val); if (isWeatherDebug) refreshWindOnly(); }
function refreshWindOnly() { updateDebugDisplay(debugWindSpeed, debugWindDir); updateWind(debugWindSpeed, debugWindDir); }
function updateDebugDisplay(speed, dir) {
    document.getElementById('debug-wind-val').innerText = Math.round(speed);
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO']; document.getElementById('debug-wind-dir-val').innerText = `${directions[Math.round(dir / 45) % 8]} (${Math.round(dir)}°)`;
    if(!isWeatherDebug) { document.getElementById('wind-slider').value = speed; document.getElementById('wind-dir-slider').value = dir; }
}
function resetWeatherDebug() { isWeatherDebug = false; document.getElementById('debug-wind-val').innerText = "Auto"; document.getElementById('debug-wind-dir-val').innerText = "Auto"; updateGlobalWeather(); }
function lerp(start, end, t) { return start * (1 - t) + end * t; }
function lerpColor(c1, c2, t) { return [Math.round(lerp(c1[0], c2[0], t)), Math.round(lerp(c1[1], c2[1], t)), Math.round(lerp(c1[2], c2[2], t))]; }
function rgbStr(c) { return `rgb(${c[0]},${c[1]},${c[2]})`; }
function rgbaStr(c, a) { return `rgba(${c[0]},${c[1]},${c[2]}, ${a})`; }
function getCloudCountFromCode(code) { if (code === 0) return 0; if (code === 1) return 4; if (code === 2) return 20; if (code === 3) return 40; if ([45, 48].includes(code)) return 150; if (code >= 51) return 100; return 5; }
function getIcon(code, isDay) { if([0,1].includes(code))return isDay?'☀️':'🌙'; if([2,3,45,48].includes(code))return '☁️'; if(code>=51&&code<=67)return '🌧️'; if(code>=71)return '❄️'; return '🌡️'; }
function getDesc(code) { const d={0:"Ensoleillé",1:"Quelques nuages",2:"Partiellement nuageux",3:"Couvert",45:"Brouillard",48:"Brouillard givrant",51:"Bruine légère",53:"Bruine modérée",55:"Bruine dense",61:"Pluie faible",63:"Pluie modérée",65:"Pluie forte",71:"Neige faible",73:"Neige modérée",75:"Forte neige",95:"Orage"}; return d[code] || "Variable"; }

// INIT
initSystem();