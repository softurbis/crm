# -*- coding: utf-8 -*-
"""
EL FACTURADOR — de una venta a un comprobante electrónico ante SUNAT.

Vive afuera del POS a propósito: los hooks de PocketBase corren en JSVM (goja),
que no tiene criptografía de firma XML. El POS le habla a esta pieza; esta
pieza habla con SUNAT.

La interfaz está en vocabulario del negocio —una venta, un cliente, unos
items— y no menciona a SUNAT. Eso es lo que la hace enchufable a otro proyecto,
y lo que permite que el día que SUNAT cambie una regla, cambie acá adentro y
nada más.

    from facturador import config, certificado, emisor

    cfg = config.cargar()
    cert = certificado.cargar(cfg)
    emisor.emitir(cfg, cert, {...})
"""
__version__ = "0.1.0"
