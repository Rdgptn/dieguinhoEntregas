"use strict";
const $ = (id) => document.getElementById(id);
const brl = (n) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const centavos = (n) => Math.round(n * 100) / 100;
let cfg;
let ultimo = null;
function lerCampo(caminho) {
    return caminho.split(".").reduce((o, k) => o?.[k], cfg) ?? "";
}
function preencherTextos() {
    document.querySelectorAll("[data-cfg]").forEach(el => el.textContent = lerCampo(el.dataset.cfg));
    $("rodZap").setAttribute("href", `https://wa.me/${cfg.marca.whatsapp}`);
}
async function obterJson(url) {
    const r = await fetch(url);
    if (!r.ok)
        throw new Error(`HTTP ${r.status}`);
    return r.json();
}
// Mapbox (se a chave estiver válida)
async function rotaMapbox(a, b) {
    const geo = async (q) => {
        const d = await obterJson(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${cfg.mapa.token}&country=${cfg.mapa.pais}&language=pt&limit=1`);
        if (!d.features?.length)
            throw new Error(`Não encontramos: ${q}.`);
        return d.features[0].center;
    };
    const [p1, p2] = await Promise.all([geo(a), geo(b)]);
    const d = await obterJson(`https://api.mapbox.com/directions/v5/mapbox/driving/${p1.join(",")};${p2.join(",")}?access_token=${cfg.mapa.token}&overview=false`);
    if (!d.routes?.length)
        throw new Error("Rota não encontrada.");
    return d.routes[0].distance / 1000;
}
// Alternativa gratuita (OpenStreetMap), usada quando o Mapbox falhar
async function rotaOSM(a, b) {
    const geo = async (q) => {
        const d = await obterJson(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=${cfg.mapa.pais}&q=${encodeURIComponent(q)}`);
        if (!d.length)
            throw new Error(`Não encontramos o endereço: ${q}.`);
        return [d[0].lon, d[0].lat];
    };
    const p1 = await geo(a);
    const p2 = await geo(b);
    const d = await obterJson(`https://router.project-osrm.org/route/v1/driving/${p1.join(",")};${p2.join(",")}?overview=false`);
    if (d.code !== "Ok" || !d.routes?.length)
        throw new Error("Rota não encontrada.");
    return d.routes[0].distance / 1000;
}
async function distanciaKm(a, b) {
    try {
        return await rotaMapbox(a, b);
    }
    catch (e) {
        if (e instanceof Error && e.message.startsWith("Não encontramos"))
            throw e;
        return rotaOSM(a, b);
    }
}
function calcular(kmBruto, veiculo, peso, paradas, urgente, agendada, pag) {
    const t = cfg.tarifas[veiculo];
    const km = Math.ceil(kmBruto * 10) / 10;
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
    const linhas = [`Percurso ${km.toFixed(1)} km: ${brl(base)}`];
    let total = base;
    const somar = (rotulo, v) => { v = centavos(v); if (v > 0) {
        total += v;
        linhas.push(`${rotulo}: ${brl(v)}`);
    } };
    somar(`Peso excedente`, Math.max(0, peso - t.pesoIncluso) * t.kgExtra);
    somar(`Paradas extras (${paradas})`, Math.max(0, paradas) * cfg.adicionais.parada);
    if (urgente)
        somar("Urgente", cfg.adicionais.urgente);
    if (agendada)
        somar("Coleta agendada", cfg.adicionais.agendada);
    if (pag === "cartaoVista")
        somar("Taxa do cartão", cfg.pagamento.cartaoVista);
    if (pag === "parcelado")
        somar(`Cartão parcelado (${cfg.pagamento.parceladoPercentual}%)`, total * cfg.pagamento.parceladoPercentual / 100);
    return { total: centavos(total), km, veiculo, linhas, pagamento: pag };
}
function enviarOS(o, coleta, entrega) {
    const n = `OS-${Date.now().toString().slice(-6)}`;
    const sel = $("pagamento");
    const pagTxt = sel.options[sel.selectedIndex]?.text ?? o.pagamento;
    const texto = [
        `*${cfg.marca.nome} — Ordem de serviço ${n}*`,
        `Data: ${new Date().toLocaleString("pt-BR")}`,
        `Veículo: ${o.veiculo === "moto" ? "Moto" : "Carro / utilitário"}`,
        `Retirar em: ${coleta}`,
        `Entregar em: ${entrega}`,
        `Pagamento: ${pagTxt}`,
        ``,
        ...o.linhas.map(l => `• ${l}`),
        ``,
        `*Total estimado: ${brl(o.total)}*`,
        `Valor sujeito a confirmação.`,
    ].join("\n");
    window.open(`https://wa.me/${cfg.marca.whatsapp}?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
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
    aviso.textContent = manual > 0 ? "" : "Calculando a distância...";
    try {
        const km = manual > 0 ? manual : await distanciaKm(coleta, entrega);
        const veiculo = (document.querySelector("input[name=veiculo]:checked")).value;
        ultimo = calcular(km, veiculo, +$("peso").value || 0, +$("paradas").value || 0, $("urgente").checked, $("agendada").checked, $("pagamento").value);
        $("total").textContent = brl(ultimo.total);
        $("detalhe").textContent = ultimo.linhas.join(" · ");
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
    cfg = await (await fetch("data/config.json")).json();
    preencherTextos();
    $("frete").addEventListener("submit", aoEnviar);
    $("btnOS").addEventListener("click", () => {
        if (ultimo)
            enviarOS(ultimo, $("coleta").value.trim(), $("entrega").value.trim());
    });
}
iniciar();
