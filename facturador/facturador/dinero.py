# -*- coding: utf-8 -*-
"""
LA PLATA, Y POR QUÉ ESTE ARCHIVO EXISTE.

Dos problemas distintos viven acá: los céntimos y el IGV.

=============================================================================
1. LOS CÉNTIMOS
=============================================================================
Cuando hay IGV, los precios de la carta son CON IGV incluido: el cholao cuesta
S/ 12 y el cliente paga S/ 12. El comprobante, en cambio, tiene que desagregar
el impuesto.

Esa cuenta parece trivial y no lo es. Hecha al descuido, el comprobante termina
diciendo un total distinto del que se cobró, por uno o dos céntimos. Con 3.130
comprobantes al mes eso es un descuadre mensual que después nadie encuentra,
porque cada comprobante suelto se ve bien.

LA REGLA: se parte SIEMPRE del total que paga el cliente, y de ahí se deriva
el resto.

    total_linea  = redondear(cantidad * precio_de_carta)
    valor_venta  = redondear(total_linea / 1.18)
    igv          = total_linea - valor_venta      <-- por RESTA, no por
                                                      multiplicación

El IGV sale de una resta a propósito. Calculado como `valor_venta * 0.18`, el
redondeo de las dos operaciones podría no cerrar y `valor_venta + igv` daría un
céntimo distinto de `total_linea`. Con la resta cierra SIEMPRE por
construcción — y lo que cierra es justamente lo que el cliente pagó y lo que
entró a la caja.

Todo con `Decimal`. Los `float` no representan 0.10 exactamente y eso, sumado
tres mil veces al mes, se nota.

=============================================================================
2. EL IGV — Y ACÁ EL NEGOCIO ES UN CASO ESPECIAL
=============================================================================
El dueño, 6-set-2026: *"nosotros estamos en Pucallpa, acá todo es sin IGV"*.

Es la **exoneración de la Amazonía** (Ley 27037): los negocios de Ucayali que
califican venden sin IGV. Pero para SUNAT eso NO es "IGV cero" — es una
operación EXONERADA, y se declara distinto:

  · GRAVADO    afectación 10, tributo 1000 IGV/VAT, 18 %
  · EXONERADO  afectación 20, tributo 9997 EXO/VAT, 0 %   <-- Pucallpa
  · INAFECTO   afectación 30, tributo 9998 INA/FRE, 0 %

Mandar una venta exonerada como gravada con importe cero es un comprobante mal
declarado, no un detalle de forma.

Con exoneración la cuenta se vuelve trivial —el valor de venta ES el precio de
carta y el impuesto es cero—, pero la estructura del comprobante cambia: los
totales se separan en gravadas, exoneradas e inafectas, y cada línea lleva su
marca. Por eso todo esto vive acá y no en un `if` suelto.

SE SOPORTA LA MEZCLA a propósito. Hoy es todo exonerado, pero alcanza con que
entre un producto que no califique para necesitar las dos en el mismo
comprobante — y descubrirlo ese día, con el cliente esperando, es tarde.
"""
from decimal import Decimal, ROUND_HALF_UP

CENTIMO = Decimal("0.01")
IGV_TASA = Decimal("0.18")

GRAVADO = "gravado"
EXONERADO = "exonerado"
INAFECTO = "inafecto"

# Catálogo 07 de SUNAT (afectación) y catálogo 05 (tributo).
AFECTACIONES = {
    GRAVADO:   {"codigo": "10", "tributo": "1000", "nombre": "IGV", "tipo": "VAT", "tasa": IGV_TASA},
    EXONERADO: {"codigo": "20", "tributo": "9997", "nombre": "EXO", "tipo": "VAT", "tasa": Decimal("0")},
    INAFECTO:  {"codigo": "30", "tributo": "9998", "nombre": "INA", "tipo": "FRE", "tasa": Decimal("0")},
}


def d(valor):
    """Cualquier cosa que venga (str, int, float, Decimal) a Decimal seguro."""
    if isinstance(valor, Decimal):
        return valor
    # Pasa por str: Decimal(0.1) arrastra el error del float, Decimal("0.1") no.
    return Decimal(str(valor))


def redondear(valor):
    """A dos decimales, medio hacia arriba — que es como redondea el comercio."""
    return d(valor).quantize(CENTIMO, rounding=ROUND_HALF_UP)


def dos(valor):
    """El texto que va al XML: siempre con dos decimales."""
    return str(redondear(valor))


class Linea:
    """
    Una línea del comprobante, ya con las cuentas hechas.

    Entra lo que sabe el POS —cuánto, a qué precio de carta y si paga IGV— y
    sale lo que necesita el XML.
    """

    def __init__(self, descripcion, cantidad, precio_con_igv, unidad="NIU",
                 codigo="", afectacion=EXONERADO):
        if afectacion not in AFECTACIONES:
            raise ValueError(
                "afectación '%s' no existe; usa gravado, exonerado o inafecto"
                % afectacion
            )
        self.descripcion = descripcion
        self.unidad = unidad
        self.codigo = codigo
        self.afectacion = afectacion
        self.cantidad = d(cantidad)
        self.precio_con_igv = d(precio_con_igv)

        tasa = AFECTACIONES[afectacion]["tasa"]

        # El único número que se toma como verdad: lo que paga el cliente.
        self.total = redondear(self.cantidad * self.precio_con_igv)
        if tasa == 0:
            # Sin impuesto no hay nada que desagregar: el precio de carta ES el
            # valor de venta. Y el IGV es cero de verdad, no un redondeo.
            self.valor_venta = self.total
            self.igv = Decimal("0.00")
        else:
            self.valor_venta = redondear(self.total / (Decimal("1") + tasa))
            self.igv = self.total - self.valor_venta

        # El valor unitario SIN IGV que va al XML. Es informativo: los totales
        # de la línea ya están fijados arriba y no se recalculan desde acá.
        if self.cantidad != 0:
            self.valor_unitario = redondear(self.valor_venta / self.cantidad)
        else:
            self.valor_unitario = Decimal("0.00")

    @property
    def datos_afectacion(self):
        return AFECTACIONES[self.afectacion]

    @property
    def porcentaje(self):
        return redondear(AFECTACIONES[self.afectacion]["tasa"] * 100)


class Totales:
    """
    La suma de las líneas, separada como la pide SUNAT.

    Nada se recalcula: se suma lo ya redondeado. Y las tres bases van por
    separado porque el comprobante las declara por separado — juntarlas y
    volver a partirlas es donde se pierden los céntimos.
    """

    def __init__(self, lineas):
        cero = Decimal("0.00")
        self.gravadas = sum((l.valor_venta for l in lineas if l.afectacion == GRAVADO), cero)
        self.exoneradas = sum((l.valor_venta for l in lineas if l.afectacion == EXONERADO), cero)
        self.inafectas = sum((l.valor_venta for l in lineas if l.afectacion == INAFECTO), cero)
        self.igv = sum((l.igv for l in lineas), cero)
        self.total = sum((l.total for l in lineas), cero)

    @property
    def valor_venta(self):
        """Las tres bases juntas: lo que va en LineExtensionAmount."""
        return self.gravadas + self.exoneradas + self.inafectas

    @property
    def hay_gravadas(self):
        return self.gravadas > 0

    @property
    def hay_exoneradas(self):
        return self.exoneradas > 0

    @property
    def hay_inafectas(self):
        return self.inafectas > 0

    def cuadra(self):
        """La comprobación que hace que todo esto valga la pena."""
        return self.valor_venta + self.igv == self.total
