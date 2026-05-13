from typing import List, Optional
from datetime import date
from sqlmodel import SQLModel, Field, Relationship


class Photo(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    stop_id: int = Field(foreign_key="stop.id")
    file_path: str
    thumbnail_path: str = ""
    taken_at: Optional[str] = None
    caption: str = ""
    stop: Optional["Stop"] = Relationship(back_populates="photos")


class Stop(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    route_id: int = Field(foreign_key="route.id")
    city_name: str
    longitude: float = 0.0
    latitude: float = 0.0
    arrival_date: Optional[str] = None
    departure_date: Optional[str] = None
    lodging: str = ""
    food: str = ""
    attractions: str = ""
    other: str = ""
    videos: str = ""
    articles: str = ""
    order: int = 0
    transport_mode: str = "drive"  # "drive" | "flight" — how the traveler arrived at this stop
    photos: List[Photo] = Relationship(back_populates="stop")
    route: Optional["Route"] = Relationship(back_populates="stops")


class Route(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    year: Optional[int] = None
    color: str = "#4ECDC4"
    description: str = ""
    is_favorite: bool = False
    qr_code_path: str = ""
    stops: List[Stop] = Relationship(back_populates="route")


# Persisted road-snapped path between two stops. Canonical storage uses
# stop_a_id < stop_b_id; callers reverse the path array if they need the
# opposite direction. Invalidated when either endpoint's coords change.
class LegPath(SQLModel, table=True):
    stop_a_id: int = Field(foreign_key="stop.id", primary_key=True)
    stop_b_id: int = Field(foreign_key="stop.id", primary_key=True)
    path_json: str  # JSON-encoded [[lng, lat], ...]
    computed_at: str  # ISO timestamp


class LegPathRead(SQLModel):
    stop_a_id: int
    stop_b_id: int
    path: List[List[float]]


class LegPathCreate(SQLModel):
    stop_a_id: int
    stop_b_id: int
    path: List[List[float]]


# Response schemas (with nested data)
class PhotoRead(SQLModel):
    id: int
    file_path: str
    thumbnail_path: str
    taken_at: Optional[str]
    caption: str


class StopRead(SQLModel):
    id: int
    route_id: int
    city_name: str
    longitude: float
    latitude: float
    arrival_date: Optional[str]
    departure_date: Optional[str]
    lodging: str
    food: str
    attractions: str
    other: str
    videos: str
    articles: str
    order: int
    transport_mode: str
    photos: List[PhotoRead] = []


class RouteRead(SQLModel):
    id: int
    name: str
    year: Optional[int]
    color: str
    description: str
    is_favorite: bool
    qr_code_path: str = ""
    stops: List[StopRead] = []


class RouteCreate(SQLModel):
    name: str
    year: Optional[int] = None
    color: str = "#4ECDC4"
    description: str = ""
    is_favorite: bool = False


class StopCreate(SQLModel):
    city_name: str
    longitude: float = 0.0
    latitude: float = 0.0
    arrival_date: Optional[str] = None
    departure_date: Optional[str] = None
    lodging: str = ""
    food: str = ""
    attractions: str = ""
    other: str = ""
    videos: str = ""
    articles: str = ""
    order: int = 0
    transport_mode: str = "drive"


class ReorderRequest(SQLModel):
    stop_ids: List[int]
