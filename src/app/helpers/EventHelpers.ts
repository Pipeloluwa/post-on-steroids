
export class EventHelpers {

  static preventPropagation($event: Event) {
    $event.stopPropagation();
  }
}

