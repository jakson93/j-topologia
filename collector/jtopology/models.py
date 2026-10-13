from dataclasses import dataclass, field
from typing import Any, Literal
import time

Source = Literal['snmp', 'netconf', 'cli', 'fixture']
TABLES = ('nodes', 'interfaces', 'links', 'ospf', 'tunnels', 'lsps', 'paths', 'services', 'pws', 'bindings', 'collector')

def now_ms() -> int:
    return int(time.time() * 1000)

@dataclass
class Batch:
    device_id: str
    source: Source
    observed_at: int
    tables: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    # Only a successfully read, fully parsed list may remove disappeared records.
    authoritative: set[str] = field(default_factory=set)
    warnings: list[str] = field(default_factory=list)

    def add(self, table: str, row: dict[str, Any]) -> None:
        if table not in TABLES or not row.get('id'):
            raise ValueError('Unknown table or missing stable ID')
        rows=self.tables.setdefault(table, [])
        existing=next((r for r in rows if r['id']==row['id']),None)
        record={k:v for k,v in row.items() if v is not None}
        record.update(deviceId=self.device_id,dataSource=self.source,observedAt=self.observed_at)
        if existing is not None:existing.update(record)
        else:rows.append(record)

@dataclass
class Device:
    id: str
    host: str
    site: str = ''
    snmp: dict[str, Any] = field(default_factory=dict)
    ssh: dict[str, Any] = field(default_factory=dict)
    netconf: dict[str, Any] = field(default_factory=dict)
    # Version-gated CLI profiles must be checked against the actual VRP release.
    vrp_pattern: str = r'V(?:200|600)R\d{3}C\d{2}|Version\s+5\.170\b'
    cli_enabled: bool = False
    # Each GET profile declares its YANG capability and XML subtree.
    yang_profiles: list[dict[str, Any]] = field(default_factory=list)

def stable(device: str, name: str) -> str:
    return f'{device}:{name}'
