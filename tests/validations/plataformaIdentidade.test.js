const { identidadeSchema } = require('../../src/validations/plataformaValidation');
const { TEMAS_VISUAIS, resolverTemaVisual, SLUG_REGEX } = require('../../src/constants/temasVisuais');

describe('temas visuais', () => {
  test('o conjunto fechado inclui vertumno (padrão), cherry e valvazori', () => {
    expect(TEMAS_VISUAIS).toEqual(['vertumno', 'cherry', 'valvazori']);
  });

  test('tema desconhecido, vazio ou ausente cai no padrão vertumno', () => {
    expect(resolverTemaVisual('valvazori')).toBe('valvazori');
    for (const valor of ['x', '', null, undefined, 'CHERRY']) expect(resolverTemaVisual(valor)).toBe('vertumno');
  });
});

describe('identidadeSchema', () => {
  test('aceita tema, slug ou os dois', () => {
    expect(identidadeSchema.safeParse({ tema_visual: 'valvazori' }).success).toBe(true);
    expect(identidadeSchema.safeParse({ slug: 'valvazori' }).success).toBe(true);
    expect(identidadeSchema.safeParse({ tema_visual: 'cherry', slug: 'cherry' }).success).toBe(true);
  });

  test('slug null remove o identificador', () => {
    const r = identidadeSchema.safeParse({ slug: null });
    expect(r.success).toBe(true);
    expect(r.data.slug).toBeNull();
  });

  test('slug é normalizado para minúsculas e sem espaços nas pontas', () => {
    expect(identidadeSchema.parse({ slug: '  Valvazori-SP ' }).slug).toBe('valvazori-sp');
  });

  test.each([
    [{}, 'Informe o tema e/ou o identificador'],
    [{ tema_visual: 'azul' }, 'Tema inválido'],
    [{ slug: '-abc' }, null],
    [{ slug: 'abc-' }, null],
    [{ slug: 'a b' }, null],
    [{ slug: 'ação' }, null],
    [{ slug: 'a'.repeat(41) }, null],
    [{ slug: '' }, null],
    [{ slug: 'admin' }, 'Este identificador é reservado'],
    [{ slug: 'VERTUMNO' }, 'Este identificador é reservado'],
    [{ slug: 'x', outro: 1 }, null],
  ])('recusa %j', (corpo, mensagem) => {
    const r = identidadeSchema.safeParse(corpo);
    expect(r.success).toBe(false);
    if (mensagem) expect(r.error.issues[0].message).toBe(mensagem);
  });

  test('o regex do slug aceita o limite de 40 e recusa 41', () => {
    expect(SLUG_REGEX.test('a'.repeat(40))).toBe(true);
    expect(SLUG_REGEX.test('a'.repeat(41))).toBe(false);
    expect(SLUG_REGEX.test('a')).toBe(true);
  });
});
