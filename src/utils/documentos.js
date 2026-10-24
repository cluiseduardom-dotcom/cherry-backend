// Validações de documento brasileiro. Só dígitos entram aqui (quem chama normaliza).

function digitoVerificador(base, pesoInicial) {
    const soma = base.split('').reduce((acc, d, i) => acc + Number(d) * (pesoInicial - i), 0);
    const resto = (soma * 10) % 11;

    return resto === 10 ? 0 : resto;
}

// CPF com dígitos verificadores; recusa sequência repetida (111.111.111-11 passa na conta, mas não existe).
function cpfValido(cpf) {
    if (typeof cpf !== 'string' || !/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;

    const d1 = digitoVerificador(cpf.slice(0, 9), 10);
    const d2 = digitoVerificador(cpf.slice(0, 10), 11);

    return d1 === Number(cpf[9]) && d2 === Number(cpf[10]);
}

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

module.exports = { cpfValido, UFS };
