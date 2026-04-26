"""Captura de Ctrl+C (SIGINT) con persistencia de estado parcial.

Provee un context manager `graceful_interrupt` que:
- Registra un handler de SIGINT.
- Al recibir la señal, dispara callbacks de guardado parcial.
- Loguea con loguru.
- Sale con exit code 130 (convención Unix para SIGINT).

Además expone utilidades vía `atexit` para que callbacks de "último
aliento" corran aunque el proceso termine por otra razón.

Uso básico:
    from scripts.utils.interrupts import graceful_interrupt

    with graceful_interrupt() as state:
        state.on_interrupt(lambda: guardar_csv_parcial(resultados))
        for item in tqdm(items):
            procesar(item)

Si el usuario presiona Ctrl+C, se corren los callbacks en orden LIFO y
el proceso sale con código 130. Si todo va bien, los callbacks NO se
ejecutan (excepto los registrados también vía atexit).
"""

from __future__ import annotations

import atexit
import signal
import sys
from contextlib import contextmanager
from typing import Callable, List

from loguru import logger


class InterruptState:
    """Estado compartido entre el handler y el bloque protegido.

    Atributos:
        interrupted: True si llegó un SIGINT.
        callbacks: Lista LIFO de funciones a ejecutar al interrumpir.
    """

    def __init__(self) -> None:
        self.interrupted: bool = False
        self.callbacks: List[Callable[[], None]] = []

    def on_interrupt(self, callback: Callable[[], None]) -> None:
        """Registra un callback a ejecutar si llega Ctrl+C.

        Los callbacks corren en orden LIFO (el último registrado primero),
        simulando un stack de cleanup.

        Args:
            callback: Función sin argumentos. No debe levantar (loguear y seguir).
        """
        self.callbacks.append(callback)

    def run_callbacks(self) -> None:
        """Ejecuta todos los callbacks registrados, en orden LIFO, sin propagar errores."""
        while self.callbacks:
            cb = self.callbacks.pop()
            try:
                cb()
            except Exception as e:  # noqa: BLE001 — queremos tragar todo para no bloquear cleanup
                logger.error(f"Fallo ejecutando callback de cleanup: {e}")


@contextmanager
def graceful_interrupt(exit_code: int = 130):
    """Context manager que captura SIGINT y corre callbacks antes de salir.

    Args:
        exit_code: Código de salida al interrumpir. Default 130 (convención SIGINT).

    Yields:
        InterruptState — registrar callbacks con `state.on_interrupt(cb)`.
    """
    state = InterruptState()
    previous_handler = signal.getsignal(signal.SIGINT)

    # También registramos los callbacks en atexit, para que corran si el proceso
    # muere por otra causa (excepción no manejada, SIGTERM en algunos casos).
    def _atexit_runner() -> None:
        if state.callbacks:
            logger.info("Ejecutando callbacks de salida (atexit)...")
            state.run_callbacks()

    atexit.register(_atexit_runner)

    def _handler(signum, frame):  # noqa: ARG001
        if state.interrupted:
            # Segundo Ctrl+C: salida inmediata sin más cleanup.
            logger.warning("Segunda interrupción recibida. Salida inmediata.")
            sys.exit(exit_code)
        state.interrupted = True
        logger.warning("Interrupción solicitada (Ctrl+C). Guardando estado parcial...")
        state.run_callbacks()
        logger.info(f"Saliendo con exit code {exit_code}.")
        # Restauramos el handler original antes de salir.
        signal.signal(signal.SIGINT, previous_handler)
        sys.exit(exit_code)

    signal.signal(signal.SIGINT, _handler)
    try:
        yield state
    finally:
        # Restaurar handler original al salir del bloque.
        signal.signal(signal.SIGINT, previous_handler)


def register_atexit_save(callback: Callable[[], None]) -> None:
    """Registra un callback en atexit para garantía de último aliento.

    Útil para guardado de archivos que siempre debe intentar pasar, incluso
    si la ejecución termina por una excepción fuera del context manager.

    Args:
        callback: Función sin argumentos.
    """
    atexit.register(callback)


__all__ = ["InterruptState", "graceful_interrupt", "register_atexit_save"]
