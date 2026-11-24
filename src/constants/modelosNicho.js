'use strict';

// Modelos prontos por nicho: níveis, categorias e padrão de SKU de PRODUTOS que a empresa recebe de partida,
// em vez de montar tudo do zero (empresa nova nasce sem categoria nenhuma e com um padrão de SKU sem segmentos).
// É só um ponto de partida: a empresa edita nomes, adiciona e remove categorias depois. Códigos: até 3 caracteres,
// maiúsculas, únicos no nível; depois de usados no SKU eles não mudam (regra das categorias).
// Insumos têm o próprio carregamento (onboardingService) e não entram aqui.

const PADRAO = (segmentos) => ({
    nome: 'Padrão',
    tipo_sku: 'numerico',
    separador: '-',
    tamanho_sequencia: 3,
    inicio_sequencia: 1,
    segmentos
});

const SEGMENTOS = (nome1, nome2) => [
    { nivel: 1, nome: nome1, obrigatorio: true, participa_sku: true },
    { nivel: 2, nome: nome2, obrigatorio: false, participa_sku: true }
];

const MODELOS_NICHO = Object.freeze([
    {
        id: 'confeitaria',
        nome: 'Confeitaria e doces',
        descricao: 'Bolos, tortas, doces, salgados, cupcakes, bebidas e kits, com tamanhos.',
        niveis: [{ nivel: 1, nome: 'Tipo' }, { nivel: 2, nome: 'Tamanho' }],
        categorias: [
            { nivel: 1, codigo: 'BOL', nome: 'Bolos' },
            { nivel: 1, codigo: 'TOR', nome: 'Tortas' },
            { nivel: 1, codigo: 'DOC', nome: 'Doces e brigadeiros' },
            { nivel: 1, codigo: 'SAL', nome: 'Salgados' },
            { nivel: 1, codigo: 'CUP', nome: 'Cupcakes e mini bolos' },
            { nivel: 1, codigo: 'BEB', nome: 'Bebidas' },
            { nivel: 1, codigo: 'KIT', nome: 'Kits e cestas' },
            { nivel: 2, codigo: 'P', nome: 'Pequeno' },
            { nivel: 2, codigo: 'M', nome: 'Médio' },
            { nivel: 2, codigo: 'G', nome: 'Grande' },
            { nivel: 2, codigo: 'FAM', nome: 'Família' },
            { nivel: 2, codigo: 'UNI', nome: 'Unitário' }
        ],
        padrao_sku: PADRAO(SEGMENTOS('Tipo', 'Tamanho'))
    },
    {
        id: 'lanchonete',
        nome: 'Lanchonete e restaurante',
        descricao: 'Lanches, porções, pratos, bebidas, sobremesas e combos, com tamanhos.',
        niveis: [{ nivel: 1, nome: 'Grupo' }, { nivel: 2, nome: 'Tamanho' }],
        categorias: [
            { nivel: 1, codigo: 'LAN', nome: 'Lanches' },
            { nivel: 1, codigo: 'POR', nome: 'Porções' },
            { nivel: 1, codigo: 'PRA', nome: 'Pratos' },
            { nivel: 1, codigo: 'BEB', nome: 'Bebidas' },
            { nivel: 1, codigo: 'SOB', nome: 'Sobremesas' },
            { nivel: 1, codigo: 'ACO', nome: 'Acompanhamentos' },
            { nivel: 1, codigo: 'COM', nome: 'Combos' },
            { nivel: 2, codigo: 'P', nome: 'Pequeno' },
            { nivel: 2, codigo: 'M', nome: 'Médio' },
            { nivel: 2, codigo: 'G', nome: 'Grande' },
            { nivel: 2, codigo: 'UNI', nome: 'Unitário' }
        ],
        padrao_sku: PADRAO(SEGMENTOS('Grupo', 'Tamanho'))
    },
    {
        id: 'adega',
        nome: 'Adega e bebidas',
        descricao: 'Vinhos, cervejas, destilados, espumantes, não alcoólicos e petiscos, por embalagem.',
        niveis: [{ nivel: 1, nome: 'Tipo' }, { nivel: 2, nome: 'Embalagem' }],
        categorias: [
            { nivel: 1, codigo: 'VIN', nome: 'Vinhos' },
            { nivel: 1, codigo: 'CER', nome: 'Cervejas' },
            { nivel: 1, codigo: 'DES', nome: 'Destilados' },
            { nivel: 1, codigo: 'ESP', nome: 'Espumantes' },
            { nivel: 1, codigo: 'NAL', nome: 'Não alcoólicos' },
            { nivel: 1, codigo: 'PET', nome: 'Petiscos' },
            { nivel: 1, codigo: 'ACS', nome: 'Acessórios' },
            { nivel: 2, codigo: 'GAR', nome: 'Garrafa' },
            { nivel: 2, codigo: 'LAT', nome: 'Lata' },
            { nivel: 2, codigo: 'LNG', nome: 'Long neck' },
            { nivel: 2, codigo: 'CX', nome: 'Caixa' },
            { nivel: 2, codigo: 'KIT', nome: 'Kit' }
        ],
        padrao_sku: PADRAO(SEGMENTOS('Tipo', 'Embalagem'))
    },
    {
        id: 'semijoias',
        nome: 'Semijoias e acessórios',
        descricao: 'Brincos, colares, anéis, pulseiras, conjuntos e pingentes, por cor do banho.',
        niveis: [{ nivel: 1, nome: 'Tipo de peça' }, { nivel: 2, nome: 'Cor' }],
        categorias: [
            { nivel: 1, codigo: 'BR', nome: 'Brincos' },
            { nivel: 1, codigo: 'CO', nome: 'Colares' },
            { nivel: 1, codigo: 'AN', nome: 'Anéis' },
            { nivel: 1, codigo: 'PU', nome: 'Pulseiras' },
            { nivel: 1, codigo: 'TO', nome: 'Tornozeleiras' },
            { nivel: 1, codigo: 'PI', nome: 'Pingentes' },
            { nivel: 1, codigo: 'CJ', nome: 'Conjuntos' },
            { nivel: 2, codigo: 'DOU', nome: 'Dourado' },
            { nivel: 2, codigo: 'PRA', nome: 'Prateado' },
            { nivel: 2, codigo: 'ROS', nome: 'Rosé' },
            { nivel: 2, codigo: 'COL', nome: 'Colorido' }
        ],
        padrao_sku: PADRAO(SEGMENTOS('Tipo de peça', 'Cor'))
    },
    {
        id: 'moda',
        nome: 'Moda e vestuário',
        descricao: 'Camisetas, blusas, calças, vestidos, saias, casacos e acessórios, por tamanho.',
        niveis: [{ nivel: 1, nome: 'Tipo' }, { nivel: 2, nome: 'Tamanho' }],
        categorias: [
            { nivel: 1, codigo: 'CAM', nome: 'Camisetas' },
            { nivel: 1, codigo: 'BLU', nome: 'Blusas' },
            { nivel: 1, codigo: 'CAL', nome: 'Calças' },
            { nivel: 1, codigo: 'VES', nome: 'Vestidos' },
            { nivel: 1, codigo: 'SAI', nome: 'Saias' },
            { nivel: 1, codigo: 'CAS', nome: 'Casacos' },
            { nivel: 1, codigo: 'ACE', nome: 'Acessórios' },
            { nivel: 2, codigo: 'PP', nome: 'PP' },
            { nivel: 2, codigo: 'P', nome: 'P' },
            { nivel: 2, codigo: 'M', nome: 'M' },
            { nivel: 2, codigo: 'G', nome: 'G' },
            { nivel: 2, codigo: 'GG', nome: 'GG' },
            { nivel: 2, codigo: 'UNI', nome: 'Tamanho único' }
        ],
        padrao_sku: PADRAO(SEGMENTOS('Tipo', 'Tamanho'))
    },
    {
        id: 'celulares_eletronicos',
        nome: 'Celulares, eletrônicos e games',
        descricao: 'Celulares, smartwatches, eletrônicos, video games, perfumes e acessórios, por marca ou plataforma.',
        niveis: [{ nivel: 1, nome: 'Departamento' }, { nivel: 2, nome: 'Marca ou plataforma' }],
        categorias: [
            { nivel: 1, codigo: 'CEL', nome: 'Celulares' },
            { nivel: 1, codigo: 'REL', nome: 'Smartwatches e relógios' },
            { nivel: 1, codigo: 'ELE', nome: 'Eletrônicos e áudio' },
            { nivel: 1, codigo: 'GAM', nome: 'Video games' },
            { nivel: 1, codigo: 'PER', nome: 'Perfumes' },
            { nivel: 1, codigo: 'ACE', nome: 'Acessórios' },
            { nivel: 2, codigo: 'APL', nome: 'Apple' },
            { nivel: 2, codigo: 'SAM', nome: 'Samsung' },
            { nivel: 2, codigo: 'XIA', nome: 'Xiaomi' },
            { nivel: 2, codigo: 'MOT', nome: 'Motorola' },
            { nivel: 2, codigo: 'JBL', nome: 'JBL' },
            { nivel: 2, codigo: 'SON', nome: 'Sony' },
            { nivel: 2, codigo: 'MIC', nome: 'Microsoft' },
            { nivel: 2, codigo: 'NIN', nome: 'Nintendo' },
            { nivel: 2, codigo: 'OUT', nome: 'Outras marcas' }
        ],
        padrao_sku: { ...PADRAO(SEGMENTOS('Departamento', 'Marca ou plataforma')), tamanho_sequencia: 4 }
    },
    {
        // Ponto de partida vazio: um nível "Categoria" e nenhuma categoria; a empresa monta tudo. Único modelo sem categorias.
        id: 'do_zero',
        nome: 'Montar do zero',
        descricao: 'Você define os níveis e as categorias. Começa com um nível "Categoria" e nenhuma categoria.',
        niveis: [{ nivel: 1, nome: 'Categoria' }],
        categorias: [],
        padrao_sku: {
            nome: 'Padrão',
            tipo_sku: 'numerico',
            separador: '-',
            tamanho_sequencia: 4,
            inicio_sequencia: 1,
            segmentos: [{ nivel: 1, nome: 'Categoria', obrigatorio: false, participa_sku: true }]
        }
    }
]);

const IDS_MODELOS_NICHO = MODELOS_NICHO.map((m) => m.id);

function buscarModelo(id) {
    return MODELOS_NICHO.find((m) => m.id === id) ?? null;
}

// Visão para a tela: níveis com as categorias de cada um e um exemplo de SKU (primeiro código de cada nível + sequência).
function resumoDoModelo(modelo) {
    const niveis = modelo.niveis.map((n) => ({
        nivel: n.nivel,
        nome: n.nome,
        categorias: modelo.categorias.filter((c) => c.nivel === n.nivel).map((c) => ({ codigo: c.codigo, nome: c.nome }))
    }));
    const { separador, tamanho_sequencia: tamanho, inicio_sequencia: inicio } = modelo.padrao_sku;
    const partes = [...niveis.map((n) => n.categorias[0]?.codigo ?? 'XXX'), String(inicio).padStart(tamanho, '0')];

    return { id: modelo.id, nome: modelo.nome, descricao: modelo.descricao, niveis, exemplo_sku: partes.join(separador) };
}

module.exports = { MODELOS_NICHO, IDS_MODELOS_NICHO, buscarModelo, resumoDoModelo };
