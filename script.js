// ============================================================
// CONFIGURAÇÕES
// ============================================================
let dadosCompletos = {};
let dadosCidades = [];
let mapa;
let marcadores = [];
let miniMapas = {};
let panelVisible = true;
let pesquisasVisible = true;

let filtros = {
    regiao: 'todas',
    status: 'todos',
    busca: ''
};

// ============================================================
// CARREGAR DADOS
// ============================================================
async function carregarDados() {
    try {
        const response = await fetch('dados-completos.json');
        dadosCompletos = await response.json();
        dadosCidades = dadosCompletos.cidades || [];
        
        dadosCidades.forEach(c => {
            if (!c.votos_transferidos && c.votos_prefeito) {
                c.votos_transferidos = Math.round(c.votos_prefeito * (c.transferencia_esperada || 30) / 100);
            }
            // Status é sempre recalculado a partir de observações/aliados,
            // pois o campo "status" do JSON pode estar desatualizado/errado.
            c.status = calcularStatusPorObservacao(c);
        });
        
        calcularDiasRestantes();
        inicializarMapa();
        inicializarMiniMapas();
        atualizarDashboard();
        preencherRankingMini();
        configurarEventos();
        criarGraficoMiniPesquisas();
        configurarMiniMapasClick();
        configurarTogglePanel();
        configurarTogglePesquisas();
        atualizarBadgesMiniMapas();
        
        console.log(`✅ Carregados ${dadosCidades.length} municípios`);
        console.log(`📊 Total: ${calcularTotalVotos().toLocaleString()} votos`);
    } catch (error) {
        console.error('❌ Erro:', error);
        alert('Não foi possível carregar os dados.');
    }
}

// ============================================================
// CALCULAR STATUS (verde/amarelo/vermelho) A PARTIR DAS OBSERVAÇÕES
// ============================================================
function calcularStatusPorObservacao(cidade) {
    const obs = (cidade.observacoes || '').toUpperCase();
    const aliadosNomes = (cidade.aliados || []).map(a => (a.nome || '').toUpperCase());

    // ODORICO conta como se fosse o próprio Weverton (mesmo "time")
    const temWeverton =
        obs.includes('WEVERTON') || obs.includes('ODORICO') ||
        aliadosNomes.includes('WEVERTON') || aliadosNomes.includes('ODORICO');

    if (!temWeverton) return 'vermelho';

    // Tem Weverton/Odorico + algum outro nome/aliado além deles? -> amarelo
    // Só Weverton e/ou Odorico (sozinhos) -> verde
    const outrosNomes = aliadosNomes.filter(n => n && n !== 'WEVERTON' && n !== 'ODORICO');
    const outroNoTexto = obs.replace(/WEVERTON/g, '').replace(/ODORICO/g, '').trim().length > 0;

    return (outrosNomes.length > 0 || outroNoTexto) ? 'amarelo' : 'verde';
}

// ============================================================
// CALCULAR DIAS
// ============================================================
function calcularDiasRestantes() {
    const hoje = new Date();
    const eleicao = new Date(2026, 9, 4);
    const diff = Math.ceil((eleicao - hoje) / (1000 * 60 * 60 * 24));
    document.getElementById('diasRestantes').textContent = diff > 0 ? diff : 0;
}

// ============================================================
// CALCULAR TOTAL DE VOTOS
// ============================================================
function calcularTotalVotos() {
    return dadosCidades.reduce((acc, c) => acc + (c.votos_transferidos || 0), 0);
}

// ============================================================
// INICIALIZAR MAPA - TELA CHEIA
// ============================================================
function inicializarMapa() {
    mapa = L.map('mapaFull', {
        center: [-5.5, -45.5],
        zoom: 6,
        zoomControl: true,
        fadeAnimation: true,
        zoomAnimation: true
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 18
    }).addTo(mapa);

    L.control.scale({ position: 'bottomright' }).addTo(mapa);
    
    adicionarMarcadores();
    
    setTimeout(() => mapa.invalidateSize(), 100);
}

// ============================================================
// ADICIONAR MARCADORES
// ============================================================
function adicionarMarcadores() {
    marcadores.forEach(m => mapa.removeLayer(m));
    marcadores = [];

    let cidadesFiltradas = dadosCidades.filter(cidade => {
        if (filtros.regiao !== 'todas' && cidade.regiao !== filtros.regiao) return false;
        if (filtros.status !== 'todos' && cidade.status !== filtros.status) return false;
        if (filtros.busca && !cidade.nome.toLowerCase().includes(filtros.busca.toLowerCase())) return false;
        return true;
    });

    cidadesFiltradas.forEach(cidade => {
        let cor = '#95a5a6';
        let status = 'neutro';
        
        // MAPEAMENTO CORRETO DOS STATUS
        if (cidade.status === 'verde') {
            cor = '#2ecc71';
            status = 'verde';
        } else if (cidade.status === 'amarelo') {
            cor = '#f1c40f';
            status = 'amarelo';
        } else if (cidade.status === 'vermelho') {
            cor = '#e74c3c';
            status = 'vermelho';
        } else {
            cor = '#95a5a6';
            status = 'neutro';
        }

        const tamanho = Math.max(8, Math.min(22, Math.sqrt((cidade.eleitores || 5000) / 4000)));

        const circulo = L.circleMarker([cidade.lat, cidade.lng], {
            radius: tamanho,
            fillColor: cor,
            color: '#ffffff',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.85,
            className: `marcador-${status}`
        }).addTo(mapa);

        const tooltipContent = `
            <div style="font-weight:700;font-size:0.9rem;color:#fff;">${cidade.nome}</div>
            <div style="font-size:0.7rem;color:rgba(255,255,255,0.6);">
                👥 ${(cidade.eleitores || 0).toLocaleString()} eleitores
                🗳️ ${(cidade.votos_transferidos || 0).toLocaleString()} votos
            </div>
        `;
        circulo.bindTooltip(tooltipContent, { 
            permanent: false, 
            direction: 'top',
            className: 'custom-tooltip'
        });

        const popupContent = gerarPopupHTML(cidade);
        circulo.bindPopup(popupContent);

        circulo.on('click', function(e) {
            mapa.closePopup();
            this.openPopup();
        });

        marcadores.push(circulo);
    });
}

// ============================================================
// GERAR POPUP
// ============================================================
function gerarPopupHTML(cidade) {
    const statusEmoji = getStatusEmoji(cidade.status);
    const statusLabel = getStatusLabel(cidade.status);
    const votosTransferidos = cidade.votos_transferidos || Math.round((cidade.votos_prefeito || 0) * 0.3);
    
    // Definir cor do header baseada no status
    let headerColor = '#95a5a6';
    if (cidade.status === 'verde') headerColor = '#2ecc71';
    else if (cidade.status === 'amarelo') headerColor = '#f1c40f';
    else if (cidade.status === 'vermelho') headerColor = '#e74c3c';
    
    let aliadosHTML = '';
    if (cidade.aliados && cidade.aliados.length > 0) {
        const nomes = cidade.aliados.map(a => a.nome).join(', ');
        aliadosHTML = `
            <div style="background:rgba(255,255,255,0.05);border-radius:4px;padding:6px 10px;margin:3px 0;font-size:0.8rem;color:rgba(255,255,255,0.7);">
                <strong style="color:#ffffff;">Apoios:</strong> ${nomes}
            </div>
        `;
    } else {
        aliadosHTML = `<div style="color:rgba(255,255,255,0.3);font-size:0.8rem;font-style:italic;">Sem apoios definidos</div>`;
    }

    return `
        <div class="popup-wrapper">
            <div class="popup-header" style="background:${headerColor};">
                <h3>
                    🏙️ ${cidade.nome}
                    <span class="regiao-tag">${cidade.regiao || 'Sem região'}</span>
                </h3>
                <span class="status-popup ${cidade.status || 'neutro'}">
                    ${statusEmoji} ${statusLabel}
                </span>
            </div>
            <div class="popup-body">
                <div class="info-row">
                    <span class="label">👨‍💼 Prefeito</span>
                    <span class="value">${cidade.prefeito || 'N/A'} ${cidade.partido_prefeito ? `(${cidade.partido_prefeito})` : ''}</span>
                </div>
                <div class="info-row">
                    <span class="label">👥 Eleitores</span>
                    <span class="value">${cidade.eleitores ? cidade.eleitores.toLocaleString() : 'N/A'}</span>
                </div>
                <div class="transferencia-box">
                    <div style="font-size:0.7rem;color:rgba(255,255,255,0.5);">🔄 Transferência (${cidade.transferencia_esperada || 30}%)</div>
                    <div class="valor">${votosTransferidos.toLocaleString()} votos</div>
                </div>
                <hr style="border-color:rgba(255,255,255,0.06);margin:8px 0;" />
                <div style="font-weight:600;margin-bottom:4px;font-size:0.8rem;">🤝 Lideranças / Apoios</div>
                ${aliadosHTML}
                ${cidade.coordenador ? `<div style="font-size:0.7rem;color:rgba(255,255,255,0.4);margin-top:6px;">📋 Coordenador: ${cidade.coordenador}</div>` : ''}
                ${cidade.observacoes ? `<div class="observacao">📝 ${cidade.observacoes}</div>` : ''}
            </div>
        </div>
    `;
}

// ============================================================
// FUNÇÕES AUXILIARES
// ============================================================
function getStatusEmoji(status) {
    const map = {
        'verde': '🟢',
        'amarelo': '🟡',
        'vermelho': '🔴',
        'neutro': '⚪'
    };
    return map[status] || '⚪';
}

function getStatusLabel(status) {
    const map = {
        'verde': 'Weverton 1º Voto',
        'amarelo': 'Weverton 1º ou 2º Voto',
        'vermelho': 'Indefinido',
        'neutro': 'Indefinido'
    };
    return map[status] || 'Indefinido';
}

// ============================================================
// INICIALIZAR MINI-MAPAS
// ============================================================
function inicializarMiniMapas() {
    const regioes = ['GSL', 'Tocantina', 'Cocais', 'Delta', 'Mearim', 'Baixada', 'Sul'];
    const ids = ['miniMapGSL', 'miniMapTocantina', 'miniMapCocais', 'miniMapDelta', 'miniMapMearim', 'miniMapBaixada', 'miniMapSul'];
    
    regioes.forEach((regiao, index) => {
        const containerId = ids[index];
        const container = document.getElementById(containerId);
        if (!container) return;
        
        container.innerHTML = '';
        
        const miniMap = L.map(containerId, {
            center: [-5.5, -45.5],
            zoom: 5,
            zoomControl: false,
            attributionControl: false,
            dragging: false,
            scrollWheelZoom: false,
            doubleClickZoom: false,
            boxZoom: false,
            keyboard: false
        });
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: ''
        }).addTo(miniMap);
        
        const nomeRegiao = getNomeRegiao(regiao);
        const cidadesRegiao = dadosCidades.filter(c => c.regiao === nomeRegiao);
        
        cidadesRegiao.forEach(cidade => {
            if (cidade.lat && cidade.lng) {
                let cor = '#95a5a6';
                if (cidade.status === 'verde') cor = '#2ecc71';
                else if (cidade.status === 'amarelo') cor = '#f1c40f';
                else if (cidade.status === 'vermelho') cor = '#e74c3c';
                
                L.circleMarker([cidade.lat, cidade.lng], {
                    radius: 3,
                    fillColor: cor,
                    color: '#ffffff',
                    weight: 1,
                    opacity: 1,
                    fillOpacity: 0.85
                }).addTo(miniMap);
            }
        });
        
        if (cidadesRegiao.length > 0) {
            const bounds = L.latLngBounds(cidadesRegiao.filter(c => c.lat && c.lng).map(c => [c.lat, c.lng]));
            if (bounds.isValid()) {
                miniMap.fitBounds(bounds, { padding: [10, 10] });
            }
        }
        
        miniMapas[containerId] = miniMap;
        
        setTimeout(() => miniMap.invalidateSize(), 300);
    });
}

function getNomeRegiao(abrev) {
    const map = {
        'GSL': 'Grande São Luís',
        'Tocantina': 'Região Tocantina',
        'Cocais': 'Cocais',
        'Delta': 'Delta do Parnaíba',
        'Mearim': 'Mearim',
        'Baixada': 'Baixada',
        'Sul': 'Sul do MA'
    };
    return map[abrev] || abrev;
}

// ============================================================
// ATUALIZAR BADGES DOS MINI-MAPAS
// ============================================================
function atualizarBadgesMiniMapas() {
    const mapeamento = {
        'Grande São Luís': 'badgeGSL',
        'Região Tocantina': 'badgeTocantina',
        'Cocais': 'badgeCocais',
        'Delta do Parnaíba': 'badgeDelta',
        'Mearim': 'badgeMearim',
        'Baixada': 'badgeBaixada',
        'Sul do MA': 'badgeSul'
    };
    
    for (const [regiao, badgeId] of Object.entries(mapeamento)) {
        const cidades = dadosCidades.filter(c => c.regiao === regiao);
        const badge = document.getElementById(badgeId);
        if (badge) {
            badge.textContent = cidades.length;
            // Mudar cor baseada na maioria
            const verdes = cidades.filter(c => c.status === 'verde').length;
            const amarelos = cidades.filter(c => c.status === 'amarelo').length;
            const vermelhos = cidades.filter(c => c.status === 'vermelho').length;
            
            badge.className = 'badge';
            if (verdes >= amarelos && verdes >= vermelhos && verdes > 0) {
                // maioria verde
            } else if (amarelos >= verdes && amarelos >= vermelhos && amarelos > 0) {
                badge.classList.add('amarelo');
            } else if (vermelhos > 0) {
                badge.classList.add('vermelho');
            } else {
                badge.classList.add('neutro');
            }
        }
    }
}

// ============================================================
// CONFIGURAR CLIQUE NOS MINI-MAPAS
// ============================================================
function configurarMiniMapasClick() {
    document.querySelectorAll('.mini-map-item').forEach(item => {
        item.addEventListener('click', function() {
            const regiao = this.dataset.regiao;
            if (regiao) {
                ampliarMiniMapa(regiao);
            }
        });
    });
}

function ampliarMiniMapa(regiao) {
    const cidadesRegiao = dadosCidades.filter(c => c.regiao === regiao);
    
    if (cidadesRegiao.length === 0) {
        alert(`Nenhuma cidade encontrada para: ${regiao}`);
        return;
    }
    
    const lats = cidadesRegiao.filter(c => c.lat).map(c => c.lat);
    const lngs = cidadesRegiao.filter(c => c.lng).map(c => c.lng);
    
    const centerLat = lats.reduce((a, b) => a + b, 0) / lats.length;
    const centerLng = lngs.reduce((a, b) => a + b, 0) / lngs.length;
    
    let conteudo = `
        <div style="min-width:300px;max-width:450px;background:#1a1a1a;border-radius:10px;border:1px solid rgba(255,255,255,0.08);">
            <div style="background:#e74c3c;color:white;padding:10px 14px;border-radius:10px 10px 0 0;font-weight:700;display:flex;justify-content:space-between;font-size:0.85rem;">
                <span><i class="fas fa-map-marked-alt"></i> ${regiao}</span>
                <span style="font-size:0.7rem;font-weight:400;">${cidadesRegiao.length} municípios</span>
            </div>
            <div style="padding:10px 14px;max-height:300px;overflow-y:auto;">
    `;
    
    cidadesRegiao.sort((a, b) => (b.eleitores || 0) - (a.eleitores || 0));
    cidadesRegiao.forEach(c => {
        const statusEmoji = getStatusEmoji(c.status);
        const eleitores = c.eleitores || 0;
        conteudo += `
            <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:0.75rem;color:rgba(255,255,255,0.8);cursor:pointer;" 
                 onclick="centralizarCidade(${c.lat}, ${c.lng}, '${c.nome}')">
                <span>${statusEmoji} ${c.nome}</span>
                <span style="font-weight:600;color:#e74c3c;">${eleitores.toLocaleString()} eleitores</span>
            </div>
        `;
    });
    
    conteudo += `
            </div>
            <div style="background:rgba(255,255,255,0.03);padding:4px 14px;border-radius:0 0 10px 10px;font-size:0.55rem;color:rgba(255,255,255,0.3);text-align:center;">
                Clique em uma cidade para centralizar
            </div>
        </div>
    `;
    
    mapa.closePopup();
    
    L.popup({
        className: 'popup-ampliado',
        maxWidth: 450,
        minWidth: 300
    })
    .setLatLng([centerLat, centerLng])
    .setContent(conteudo)
    .openOn(mapa);
    
    mapa.setView([centerLat, centerLng], 8);
}

window.centralizarCidade = function(lat, lng, nome) {
    mapa.setView([lat, lng], 12);
    mapa.closePopup();
    
    const cidade = dadosCidades.find(c => c.lat === lat && c.lng === lng);
    if (cidade) {
        setTimeout(() => {
            const popup = L.popup()
                .setLatLng([lat, lng])
                .setContent(gerarPopupHTML(cidade))
                .openOn(mapa);
        }, 300);
    }
};

// ============================================================
// ATUALIZAR DASHBOARD
// ============================================================
function atualizarDashboard() {
    const totalVotos = calcularTotalVotos();
    const metaGeral = 1200000;
    const totalEleitores = 5186562;
    
    const verdes = dadosCidades.filter(c => c.status === 'verde').length;
    const amarelos = dadosCidades.filter(c => c.status === 'amarelo').length;
    const vermelhos = dadosCidades.filter(c => c.status === 'vermelho').length;
    
    document.getElementById('totalEleitores').textContent = totalEleitores.toLocaleString();
    document.getElementById('metaGeral').textContent = metaGeral.toLocaleString();
    document.getElementById('votosProjetados').textContent = totalVotos.toLocaleString();
    
    const diferenca = totalVotos - metaGeral;
    const diffEl = document.getElementById('diferencaMeta');
    diffEl.textContent = (diferenca >= 0 ? '+' : '') + diferenca.toLocaleString();
    diffEl.style.color = diferenca >= 0 ? '#2ecc71' : '#e74c3c';
    
    const porcentagem = Math.min((totalVotos / metaGeral) * 100, 100);
    document.getElementById('termometroFill').style.width = porcentagem + '%';
    document.getElementById('termometroVotos').textContent = totalVotos.toLocaleString();
    document.getElementById('termometroPorcentagem').textContent = Math.round(porcentagem) + '%';
    
    document.getElementById('totalCidadesFooter').textContent = dadosCidades.length;
    document.getElementById('footerConsolidados').textContent = verdes;
    document.getElementById('footerDisputados').textContent = amarelos;
    document.getElementById('footerNeutros').textContent = vermelhos;
}

// ============================================================
// RANKING MINI
// ============================================================
function preencherRankingMini() {
    const container = document.getElementById('listaRankingMini');
    container.innerHTML = '';
    
    const sorted = [...dadosCidades].sort((a, b) => (b.votos_transferidos || 0) - (a.votos_transferidos || 0));
    const top10 = sorted.slice(0, 10);
    
    top10.forEach((cidade, index) => {
        const div = document.createElement('div');
        div.className = 'ranking-item';
        div.innerHTML = `
            <span class="posicao">#${index + 1}</span>
            <span class="nome-cidade">${cidade.nome}</span>
            <span class="votos">${(cidade.votos_transferidos || 0).toLocaleString()}</span>
        `;
        div.onclick = () => {
            if (cidade.lat && cidade.lng) {
                mapa.setView([cidade.lat, cidade.lng], 12);
                setTimeout(() => {
                    const popup = L.popup()
                        .setLatLng([cidade.lat, cidade.lng])
                        .setContent(gerarPopupHTML(cidade))
                        .openOn(mapa);
                }, 300);
            }
        };
        container.appendChild(div);
    });
}

// ============================================================
// GRÁFICO MINI PESQUISAS
// ============================================================
function criarGraficoMiniPesquisas() {
    const ctx = document.getElementById('graficoMiniPesquisas').getContext('2d');
    
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['Mar', 'Sensus', 'Quaest'],
            datasets: [{
                label: 'Weverton',
                data: [8, 16.24, 11],
                borderColor: '#e74c3c',
                backgroundColor: 'rgba(231, 76, 60, 0.15)',
                fill: true,
                tension: 0.3,
                pointBackgroundColor: '#e74c3c',
                pointRadius: 3,
                pointHoverRadius: 5,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 20,
                    ticks: {
                        color: 'rgba(255,255,255,0.2)',
                        font: { size: 7 },
                        callback: (v) => v + '%'
                    },
                    grid: { color: 'rgba(255,255,255,0.05)' }
                },
                x: {
                    ticks: {
                        color: 'rgba(255,255,255,0.2)',
                        font: { size: 7 }
                    },
                    grid: { color: 'rgba(255,255,255,0.05)' }
                }
            }
        }
    });
}

// ============================================================
// CONFIGURAR TOGGLE PAINEL ESQUERDA
// ============================================================
function configurarTogglePanel() {
    document.getElementById('btnTogglePanel').addEventListener('click', () => {
        const panel = document.getElementById('floatingPanel');
        panel.classList.toggle('hidden');
        panelVisible = !panelVisible;
        
        const btn = document.getElementById('btnTogglePanel');
        btn.innerHTML = panelVisible ? '<i class="fas fa-chart-bar"></i>' : '<i class="fas fa-times"></i>';
    });
}

// ============================================================
// CONFIGURAR TOGGLE PAINEL PESQUISAS
// ============================================================
function configurarTogglePesquisas() {
    document.getElementById('btnTogglePesquisas').addEventListener('click', () => {
        const panel = document.getElementById('pesquisasPanel');
        panel.classList.toggle('minimizado');
        pesquisasVisible = !pesquisasVisible;
    });
    
    document.querySelector('.pesquisas-panel-header').addEventListener('click', (e) => {
        if (e.target.closest('.btn-toggle-pesquisas')) return;
        const panel = document.getElementById('pesquisasPanel');
        panel.classList.toggle('minimizado');
        pesquisasVisible = !pesquisasVisible;
    });
}

// ============================================================
// CONFIGURAR EVENTOS
// ============================================================
function configurarEventos() {
    document.getElementById('filtroRegiao').addEventListener('change', (e) => {
        filtros.regiao = e.target.value;
        adicionarMarcadores();
    });
    
    document.getElementById('filtroStatus').addEventListener('change', (e) => {
        filtros.status = e.target.value;
        adicionarMarcadores();
    });
    
    document.getElementById('buscaCidade').addEventListener('input', (e) => {
        filtros.busca = e.target.value;
        adicionarMarcadores();
    });
}

// ============================================================
// INICIAR
// ============================================================
document.addEventListener('DOMContentLoaded', carregarDados);

window.addEventListener('resize', () => {
    if (mapa) setTimeout(() => mapa.invalidateSize(), 200);
    Object.values(miniMapas).forEach(m => {
        setTimeout(() => m.invalidateSize(), 200);
    });
});
