const repository = require('../repositories/empresasIdentidadeRepository');
const { SLUG_REGEX, resolverTemaVisual } = require('../constants/temasVisuais');

// Sem login. Devolve SÓ o necessário para desenhar a tela de login da marca: o tema da empresa ativa
// que tem esse identificador. Identificador malformado, inexistente ou de empresa inativa respondem
// o mesmo 404, para a rota não servir de sonda de empresas.
async function marca(req, res, next) {
    try {
        const slug = String(req.params.slug ?? '').toLowerCase();
        const encontrada = SLUG_REGEX.test(slug) ? await repository.buscarMarcaPorSlug(slug) : null;

        res.set('Cache-Control', 'no-store');

        if (!encontrada) {
            return res.status(404).json({ success: false, message: 'Marca não encontrada' });
        }

        return res.json({ success: true, data: { slug: encontrada.slug, tema: resolverTemaVisual(encontrada.tema_visual) } });
    } catch (error) {
        next(error);
    }
}

module.exports = { marca };
