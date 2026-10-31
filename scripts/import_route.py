"""Import a route atomically into the configured local/remote database.

Run from the repository root: python scripts/import_route.py data/route.json
Set DATA_DIR to target a separate database. Re-running identical data is safe.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from main import engine, route_to_read
from models import Route, Stop, RouteCreate, StopCreate
from sqlmodel import Session, select


def import_route(payload):
    route_data = RouteCreate.model_validate({k: v for k, v in payload.items() if k != 'stops'})
    stops = [StopCreate.model_validate(s) for s in payload['stops']]
    if len(stops) < 2 or [s.order for s in stops] != list(range(len(stops))):
        raise ValueError('Stops must have consecutive order values starting at zero')
    with Session(engine) as session:
        existing = session.exec(select(Route).where(Route.name == route_data.name)).first()
        if existing:
            actual = route_to_read(existing, session)
            if any(getattr(actual, k) != v for k, v in route_data.model_dump().items()) or [
                {k: getattr(s, k) for k in StopCreate.model_fields} for s in actual.stops
            ] != [s.model_dump() for s in stops]:
                raise ValueError('A different route already has this name; refusing to overwrite')
            return actual
        route = Route(**route_data.model_dump())
        session.add(route)
        session.flush()
        for stop in stops:
            session.add(Stop(route_id=route.id, **stop.model_dump()))
        session.commit()
        return route_to_read(route, session)


if __name__ == '__main__':
    result = import_route(json.loads(Path(sys.argv[1]).read_text()))
    print(json.dumps(result.model_dump(), ensure_ascii=False))
