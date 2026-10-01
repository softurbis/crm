# -*- coding: utf-8 -*-
"""
EL MONTO EN LETRAS.

SUNAT lo exige en el comprobante (`cbc:Note` con languageLocaleID 1000):
"CIENTO DIECIOCHO CON 00/100 SOLES".

Es de esas cosas que parecen un detalle hasta que rechazan el comprobante por
no tenerlo. Se escribe una vez y no se toca más.
"""
from decimal import Decimal

from .dinero import redondear

UNIDADES = [
    "", "UNO", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO",
    "NUEVE", "DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISEIS",
    "DIECISIETE", "DIECIOCHO", "DIECINUEVE", "VEINTE",
]
DECENAS = [
    "", "", "VEINTI", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA",
    "OCHENTA", "NOVENTA",
]
CENTENAS = [
    "", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS",
    "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS",
]

MONEDAS = {
    "PEN": "SOLES",
    "USD": "DOLARES AMERICANOS",
    "EUR": "EUROS",
}


def _hasta_999(n):
    if n == 0:
        return ""
    if n == 100:
        return "CIEN"
    texto = ""
    c, resto = divmod(n, 100)
    if c:
        texto += CENTENAS[c] + " "
    if resto <= 20:
        texto += UNIDADES[resto]
    else:
        d, u = divmod(resto, 10)
        if d == 2:
            # "VEINTIUNO" va junto; "TREINTA Y UNO", separado.
            texto += DECENAS[2] + (UNIDADES[u].lower() if u else "").upper()
        else:
            texto += DECENAS[d] + (" Y " + UNIDADES[u] if u else "")
    return texto.strip()


def _entero(n):
    if n == 0:
        return "CERO"
    if n >= 1_000_000:
        millones, resto = divmod(n, 1_000_000)
        cabeza = "UN MILLON" if millones == 1 else _entero(millones) + " MILLONES"
        return (cabeza + " " + _entero(resto)).strip() if resto else cabeza
    if n >= 1000:
        miles, resto = divmod(n, 1000)
        cabeza = "MIL" if miles == 1 else _hasta_999(miles) + " MIL"
        return (cabeza + " " + _hasta_999(resto)).strip() if resto else cabeza
    return _hasta_999(n)


def en_letras(monto, moneda="PEN"):
    valor = redondear(monto)
    entero = int(valor)
    centavos = int((valor - Decimal(entero)) * 100)
    return "%s CON %02d/100 %s" % (
        _entero(entero),
        centavos,
        MONEDAS.get(moneda, moneda),
    )
