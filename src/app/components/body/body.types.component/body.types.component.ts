import { Component, signal } from '@angular/core';

@Component({
  selector: 'app-body-types-component',
  imports: [],
  templateUrl: './body.types.component.html',
  styleUrl: './body.types.component.css',
})
export class BodyTypesComponent {

  bodyTypes: string[] = [
    "none",
    "raw",
    "form-data",  
  ]

  rawTypes: string[] = [
    "json",
    "xml"
  ]


  bodyType = signal<string>("none");
  rawType = signal<string>("json");

}
