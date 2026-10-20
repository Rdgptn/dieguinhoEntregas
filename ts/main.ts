interface Tabela { faixa1Km:number; faixa1Valor:number; faixa2Km:number; faixa2Valor:number; kmExtra:number; limiteLongaKm:number; kmLonga:number; pesoIncluso:number; kgExtra:number }
interface Config {
  mapa: { token:string; pais:string };
  marca: Record<string,string>;
  tarifas: Record<string,Tabela>;
  adicionais: { urgente:number; agendada:number; parada:number };
  pagamento: { cartaoVista:number; parceladoPercentual:number };
}
interface Orcamento { total:number; km:number; veiculo:string; linhas:string[] }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const brl = (n:number) => n.toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
let cfg: Config;
let ultimo: Orcamento | null = null;

function lerCampo(caminho:string): string {
  return caminho.split(".").reduce((o:any,k)=>o?.[k], cfg) ?? "";
}

function preencherTextos(): void {
  document.querySelectorAll<HTMLElement>("[data-cfg]").forEach(el => el.textContent = lerCampo(el.dataset.cfg!));
  $("rodZap").setAttribute("href", `https://wa.me/${cfg.marca.whatsapp}`);
  $("rodMail").setAttribute("href", `mailto:${cfg.marca.email}`);
}

async function geocodificar(q:string): Promise<[number,number]> {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${cfg.mapa.token}&country=${cfg.mapa.pais}&language=pt&limit=1`;
  const d = await (await fetch(url)).json();
  if (!d.features?.length) throw new Error(`Não encontramos: ${q}.`);
  return d.features[0].center as [number,number];
}

async function distanciaKm(a:string, b:string): Promise<number> {
  const [p1,p2] = await Promise.all([geocodificar(a), geocodificar(b)]);
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${p1.join(",")};${p2.join(",")}?access_token=${cfg.mapa.token}&overview=false`;
  const d = await (await fetch(url)).json();
  if (!d.routes?.length) throw new Error("Rota não encontrada.");
  return d.routes[0].distance / 1000;
}

function calcular(km:number, veiculo:string, peso:number, paradas:number, urgente:boolean, agendada:boolean, pag:string): Orcamento {
  const t = cfg.tarifas[veiculo];
  let base: number;
  if (km > t.limiteLongaKm) base = km * t.kmLonga;
  else if (km <= t.faixa1Km) base = t.faixa1Valor;
  else if (km <= t.faixa2Km) base = t.faixa2Valor;
  else base = t.faixa2Valor + (km - t.faixa2Km) * t.kmExtra;

  const linhas = [`Percurso ${km.toFixed(1)} km: ${brl(base)}`];
  let total = base;
  const somar = (rotulo:string, v:number) => { if (v > 0) { total += v; linhas.push(`${rotulo}: ${brl(v)}`); } };

  somar("Peso excedente", Math.max(0, peso - t.pesoIncluso) * t.kgExtra);
  somar(`Paradas extras (${paradas})`, paradas * cfg.adicionais.parada);
  if (urgente) somar("Urgente", cfg.adicionais.urgente);
  if (agendada) somar("Coleta agendada", cfg.adicionais.agendada);
  if (pag === "cartaoVista") somar("Taxa do cartão", cfg.pagamento.cartaoVista);
  if (pag === "parcelado") somar(`Cartão parcelado (${cfg.pagamento.parceladoPercentual}%)`, total * cfg.pagamento.parceladoPercentual / 100);
  return { total, km, veiculo, linhas };
}

function resumoTexto(o:Orcamento, coleta:string, entrega:string): string {
  return `Olá! Quero pedir uma entrega (${o.veiculo}).\nRetirar: ${coleta}\nEntregar: ${entrega}\nTotal estimado: ${brl(o.total)}`;
}

function gerarOS(o:Orcamento, coleta:string, entrega:string): void {
  const w = window.open("", "_blank");
  if (!w) { $("aviso").textContent = "Libere pop-ups para gerar a ordem de serviço."; return; }
  const n = `OS-${Date.now().toString().slice(-6)}`;
  w.document.write(`<title>${n}</title><body style="font-family:sans-serif;max-width:600px;margin:2rem auto">
    <h1>${cfg.marca.nome}</h1><h2>Ordem de serviço ${n}</h2><p>${new Date().toLocaleString("pt-BR")}</p>
    <p><b>Veículo:</b> ${o.veiculo}</p><p><b>Retirar em:</b> ${coleta}</p><p><b>Entregar em:</b> ${entrega}</p>
    <ul>${o.linhas.map(l=>`<li>${l}</li>`).join("")}</ul><h2>Total: ${brl(o.total)}</h2>
    <p><small>Valor estimado, sujeito a confirmação. Escolha "Salvar como PDF" na impressão.</small></p></body>`);
  w.document.close(); w.print();
}

async function aoEnviar(e:Event): Promise<void> {
  e.preventDefault();
  const aviso = $("aviso"); aviso.textContent = "";
  const coleta = $<HTMLInputElement>("coleta").value.trim();
  const entrega = $<HTMLInputElement>("entrega").value.trim();
  const manual = parseFloat($<HTMLInputElement>("km").value);
  try {
    const km = manual > 0 ? manual : await distanciaKm(coleta, entrega);
    const veiculo = (document.querySelector<HTMLInputElement>("input[name=veiculo]:checked"))!.value;
    ultimo = calcular(km, veiculo,
      +$<HTMLInputElement>("peso").value || 0, +$<HTMLInputElement>("paradas").value || 0,
      $<HTMLInputElement>("urgente").checked, $<HTMLInputElement>("agendada").checked,
      $<HTMLSelectElement>("pagamento").value);
    $("total").textContent = brl(ultimo.total);
    $("detalhe").textContent = ultimo.linhas.join(" · ");
    $("resultado").hidden = false;
    $("btnZap").setAttribute("href", `https://wa.me/${cfg.marca.whatsapp}?text=${encodeURIComponent(resumoTexto(ultimo, coleta, entrega))}`);
  } catch (err) {
    aviso.textContent = `${(err as Error).message} Se preferir, informe a distância manualmente.`;
  }
}

async function iniciar(): Promise<void> {
  cfg = await (await fetch("data/config.json")).json();
  preencherTextos();
  $("frete").addEventListener("submit", aoEnviar);
  $("btnOS").addEventListener("click", () => {
    if (ultimo) gerarOS(ultimo, $<HTMLInputElement>("coleta").value, $<HTMLInputElement>("entrega").value);
  });
}
iniciar();
