import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ScrollableSelectComponent } from "../../../shared/scrollable.select.component/scrollable.select.component";
import { MatIcon } from "@angular/material/icon";

@Component({
  standalone: true,
  selector: 'app-body-types-component',
  imports: [FormsModule, ScrollableSelectComponent, MatIcon],
  templateUrl: './body.types.component.html',
  styleUrl: './body.types.component.css',
})
export class BodyTypesComponent {

  bodyTypes: string[] = [
    "none",
    "form-data",
    "raw",
  ]

  rawTypes: string[] = [
    "JSON",
    "XML"
  ]


  bodyType = signal<string>("raw");
  rawType = signal<string>("JSON");
  isRawTypeModalOpen = signal<boolean>(false);

  toggleRawTypeModal() {
    this.isRawTypeModalOpen.update(v => !v);
  }

  selectRawType(type: string) {
    this.rawType.set(type);
    this.isRawTypeModalOpen.set(false);
  }

}
