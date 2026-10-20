"use strict";
const $ = (id) => document.getElementById(id);
const brl = (n) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const centavos = (n) => Math.round(n * 100) / 100;
const kmTxt = (n) => n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " km";
const nomeVeiculo = (v) => (v === "moto" ? "Moto" : "Carro / utilitário");
function duracaoTxt(min) {
    if (min === null)
        return "—";
    const m = Math.max(1, Math.round(min));
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}
let cfg;
let ultimo = null;
const CONFIG_STORAGE_KEY = "dieguinho-config-v1";
function mesclarConfig(base, alterada) {
    return {
        ...base,
        ...alterada,
        mapa: { ...base.mapa, ...(alterada.mapa ?? {}) },
        marca: { ...base.marca, ...(alterada.marca ?? {}) },
        tarifas: {
            ...base.tarifas,
            ...(alterada.tarifas ?? {}),
            moto: { ...base.tarifas.moto, ...(alterada.tarifas?.moto ?? {}) },
            carro: { ...base.tarifas.carro, ...(alterada.tarifas?.carro ?? {}) },
        },
        adicionais: { ...base.adicionais, ...(alterada.adicionais ?? {}) },
        pagamento: { ...base.pagamento, ...(alterada.pagamento ?? {}) },
    };
}
async function carregarConfig() {
    const base = await (await fetch("data/config.json")).json();
    try {
        const salva = localStorage.getItem(CONFIG_STORAGE_KEY);
        return salva ? mesclarConfig(base, JSON.parse(salva)) : base;
    }
    catch {
        return base;
    }
}
// ---------- Erros e rede ----------
class ErroHttp extends Error {
    constructor(status) {
        super(`HTTP ${status}`);
        this.status = status;
    }
}
class ErroEndereco extends Error {
}
class ErroRota extends Error {
}
async function obterJson(url, ms = 12000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try {
        const r = await fetch(url, { signal: ctl.signal });
        if (!r.ok)
            throw new ErroHttp(r.status);
        return await r.json();
    }
    finally {
        clearTimeout(t);
    }
}
// ---------- Cálculo de rota ----------
// 1) Mapbox: Geocoding v6 + Directions v5. A base da empresa serve de referência (proximity),
//    para que "Rua dos Apiaris" seja buscada perto de Diadema e não em outro estado.
async function rotaMapbox(a, b) {
    const token = encodeURIComponent(cfg.mapa.token);
    const [px, py] = cfg.mapa.proximidade;
    const geo = async (q) => {
        const d = await obterJson(`https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(q)}&country=${cfg.mapa.pais}` +
            `&language=pt&limit=1&autocomplete=false&proximity=${px},${py}&access_token=${token}`);
        const f = d.features?.[0];
        if (!f)
            throw new ErroEndereco(`Não encontramos o endereço: ${q}.`);
        const [lon, lat] = f.geometry.coordinates;
        const nome = f.properties?.full_address ?? [f.properties?.name, f.properties?.place_formatted].filter(Boolean).join(", ");
        return { lon, lat, nome };
    };
    const [p1, p2] = await Promise.all([geo(a), geo(b)]);
    const d = await obterJson(`https://api.mapbox.com/directions/v5/mapbox/driving/${p1.lon},${p1.lat};${p2.lon},${p2.lat}` +
        `?overview=false&alternatives=false&access_token=${token}`);
    if (d.code !== "Ok" || !d.routes?.length)
        throw new ErroRota("Não foi possível traçar uma rota entre os endereços.");
    return { km: d.routes[0].distance / 1000, minutos: d.routes[0].duration / 60, origem: p1.nome, destino: p2.nome, fonte: "Mapbox" };
}
// 2) Alternativa gratuita (OpenStreetMap) caso o Mapbox recuse a chave, atinja o limite ou fique fora do ar.
async function rotaOSM(a, b) {
    const [px, py] = cfg.mapa.proximidade;
    const geo = async (q) => {
        // viewbox ao redor da base (~±1,5°) prioriza a Grande São Paulo / Baixada sem excluir o resto do país
        const vb = `${px - 1.5},${py + 1.5},${px + 1.5},${py - 1.5}`;
        const d = await obterJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=pt-BR&countrycodes=${cfg.mapa.pais}` +
            `&viewbox=${vb}&q=${encodeURIComponent(q)}`);
        if (!d.length)
            throw new ErroEndereco(`Não encontramos o endereço: ${q}.`);
        return { lon: d[0].lon, lat: d[0].lat, nome: d[0].display_name };
    };
    const p1 = await geo(a);
    const p2 = await geo(b);
    const d = await obterJson(`https://router.project-osrm.org/route/v1/driving/${p1.lon},${p1.lat};${p2.lon},${p2.lat}?overview=false`);
    if (d.code !== "Ok" || !d.routes?.length)
        throw new ErroRota("Não foi possível traçar uma rota entre os endereços.");
    return { km: d.routes[0].distance / 1000, minutos: d.routes[0].duration / 60, origem: p1.nome, destino: p2.nome, fonte: "OpenStreetMap" };
}
async function calcularRota(a, b) {
    let primeiro;
    try {
        return await rotaMapbox(a, b);
    }
    catch (e) {
        primeiro = e;
    }
    try {
        return await rotaOSM(a, b);
    }
    catch (e) {
        // Prefere a mensagem mais útil ao cliente (endereço não encontrado) a um erro técnico de rede.
        const erro = [primeiro, e].find(x => x instanceof ErroEndereco || x instanceof ErroRota);
        if (erro)
            throw erro;
        throw new Error("Não conseguimos calcular a distância agora (serviço de mapas indisponível).");
    }
}
// ---------- Preço ----------
function calcular(km, veiculo, peso, paradas, urgente, agendada, pag) {
    const t = cfg.tarifas[veiculo];
    km = Math.ceil(km * 10) / 10;
    let base;
    if (km <= t.faixa1Km)
        base = t.faixa1Valor;
    else if (km <= t.faixa2Km)
        base = t.faixa2Valor;
    else if (km <= t.limiteLongaKm)
        base = t.faixa2Valor + (km - t.faixa2Km) * t.kmExtra;
    else
        base = t.faixa2Valor + (t.limiteLongaKm - t.faixa2Km) * t.kmExtra + (km - t.limiteLongaKm) * t.kmLonga;
    base = centavos(base);
    const itens = [{ rotulo: `Percurso (${kmTxt(km)})`, valor: base }];
    let total = base;
    const somar = (rotulo, v) => { v = centavos(v); if (v > 0) {
        total += v;
        itens.push({ rotulo, valor: v });
    } };
    somar("Peso excedente", Math.max(0, peso - t.pesoIncluso) * t.kgExtra);
    if (paradas > 0)
        somar(`Paradas extras (${paradas})`, paradas * cfg.adicionais.parada);
    if (urgente)
        somar("Urgente", cfg.adicionais.urgente);
    if (agendada)
        somar("Coleta agendada", cfg.adicionais.agendada);
    if (pag === "cartaoVista")
        somar("Taxa do cartão", cfg.pagamento.cartaoVista);
    if (pag === "parcelado")
        somar(`Cartão parcelado (${cfg.pagamento.parceladoPercentual}%)`, total * cfg.pagamento.parceladoPercentual / 100);
    return { total: centavos(total), km, itens };
}
// ---------- Ordem de serviço ----------
const dataHora = (d) => d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
function textoWhats(o) {
    return [
        `*${cfg.marca.nome} — Ordem de serviço ${o.numero}*`,
        `Data: ${dataHora(o.emissao)}`,
        `Veículo: ${nomeVeiculo(o.veiculo)}`,
        `Retirar em: ${o.coleta}`,
        `Entregar em: ${o.entrega}`,
        `Distância: ${kmTxt(o.km)}${o.minutos !== null ? ` (~${duracaoTxt(o.minutos)})` : ""}`,
        `Pagamento: ${o.pagamentoTxt}`,
        ``,
        ...o.itens.map(i => `• ${i.rotulo}: ${brl(i.valor)}`),
        ``,
        `*Total estimado: ${brl(o.total)}*`,
        `Valor sujeito a confirmação.`,
    ].join("\n");
}
function enviarWhats(o) {
    window.open(`https://wa.me/${cfg.marca.whatsapp}?text=${encodeURIComponent(textoWhats(o))}`, "_blank", "noopener");
}
function montarOS(o) {
    const set = (id, v) => { $(id).textContent = v; };
    set("osNumero", o.numero);
    set("osData", dataHora(o.emissao));
    set("osVeiculo", nomeVeiculo(o.veiculo));
    set("osDistancia", kmTxt(o.km));
    set("osTempo", duracaoTxt(o.minutos));
    set("osPagamento", o.pagamentoTxt);
    set("osColeta", o.coleta);
    set("osColetaRes", o.coletaRes);
    set("osEntrega", o.entrega);
    set("osEntregaRes", o.entregaRes);
    set("osTotal", brl(o.total));
    set("osFonte", `Distância e tempo calculados por ${o.fonte}, considerando o trajeto por vias públicas.`);
    set("osGerado", `Documento gerado em ${dataHora(o.emissao)} · ${o.numero}`);
    const corpo = $("osItens");
    corpo.replaceChildren(...o.itens.map(i => {
        const tr = document.createElement("tr");
        const a = document.createElement("td");
        a.textContent = i.rotulo;
        const b = document.createElement("td");
        b.textContent = brl(i.valor);
        b.className = "num";
        tr.append(a, b);
        return tr;
    }));
}
function abrirOS() {
    if (!ultimo)
        return;
    montarOS(ultimo);
    const dlg = $("osDialog");
    if (!dlg.open)
        dlg.showModal();
}
function imprimirOS() {
    if (!ultimo)
        return;
    // O nome sugerido ao "Salvar como PDF" é o título da página.
    const tituloOriginal = document.title;
    document.title = ultimo.numero;
    const restaurar = () => { document.title = tituloOriginal; window.removeEventListener("afterprint", restaurar); };
    window.addEventListener("afterprint", restaurar);
    window.print();
}
// ---------- Tela ----------
function lerCampo(caminho) {
    return caminho.split(".").reduce((o, k) => o?.[k], cfg) ?? "";
}
function preencherTextos() {
    document.querySelectorAll("[data-cfg]").forEach(el => el.textContent = lerCampo(el.dataset.cfg));
    $("rodZap").setAttribute("href", `https://wa.me/${cfg.marca.whatsapp}`);
}
async function aoEnviar(e) {
    e.preventDefault();
    const aviso = $("aviso");
    const botao = document.querySelector("#frete button[type=submit]");
    aviso.textContent = "";
    const coleta = $("coleta").value.trim();
    const entrega = $("entrega").value.trim();
    const manual = parseFloat($("km").value);
    botao.disabled = true;
    aviso.textContent = manual > 0 ? "" : "Calculando a rota...";
    try {
        const rota = manual > 0
            ? { km: manual, minutos: null, origem: coleta, destino: entrega, fonte: "informado manualmente" }
            : await calcularRota(coleta, entrega);
        const veiculo = (document.querySelector("input[name=veiculo]:checked")).value;
        const sel = $("pagamento");
        const r = calcular(rota.km, veiculo, +$("peso").value || 0, +$("paradas").value || 0, $("urgente").checked, $("agendada").checked, sel.value);
        ultimo = {
            numero: `OS-${Date.now().toString().slice(-6)}`, emissao: new Date(), total: r.total, km: r.km, minutos: rota.minutos, fonte: rota.fonte,
            veiculo, itens: r.itens, pagamentoTxt: sel.options[sel.selectedIndex]?.text ?? sel.value,
            coleta, entrega, coletaRes: rota.origem, entregaRes: rota.destino,
        };
        $("total").textContent = brl(ultimo.total);
        $("detalhe").textContent = ultimo.itens.map(i => `${i.rotulo}: ${brl(i.valor)}`).join(" · ");
        $("rotaInfo").textContent = rota.minutos !== null
            ? `Rota de ${kmTxt(r.km)} · cerca de ${duracaoTxt(rota.minutos)} (${rota.fonte})`
            : `Distância informada: ${kmTxt(r.km)}`;
        $("resultado").hidden = false;
        aviso.textContent = "";
    }
    catch (err) {
        aviso.textContent = `${err.message} Se preferir, informe a distância manualmente.`;
    }
    finally {
        botao.disabled = false;
    }
}
async function iniciar() {
    cfg = await carregarConfig();
    preencherTextos();
    $("frete").addEventListener("submit", aoEnviar);
    $("btnOS").addEventListener("click", abrirOS);
    $("btnZap").addEventListener("click", () => { if (ultimo)
        enviarWhats(ultimo); });
    $("osImprimir").addEventListener("click", imprimirOS);
    $("osZap").addEventListener("click", () => { if (ultimo)
        enviarWhats(ultimo); });
    $("osFechar").addEventListener("click", () => $("osDialog").close());
    $("osDialog").addEventListener("click", ev => {
        if (ev.target === ev.currentTarget)
            ev.currentTarget.close(); // clique no fundo escuro
    });
}
iniciar();
