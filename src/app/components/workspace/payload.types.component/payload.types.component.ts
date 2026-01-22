import { Component, signal } from '@angular/core';

@Component({
  standalone: true,
  selector: 'app-payload-types-component',
  imports: [],
  templateUrl: './payload.types.component.html',
  styleUrl: './payload.types.component.css',
})
export class PayloadTypesComponent {

  payloadTypes: string[] = [
    "params",
    "auth",
    "headers",
    "body",
    "scripts",
    "encryption-channel",
    "settings"
  ]

  payloadType = signal<string>("params");


}
